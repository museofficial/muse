#!/usr/bin/env bash
set -euo pipefail

repository="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
release_tag="${RELEASE_TAG:?RELEASE_TAG is required}"
release_name="${RELEASE_NAME:-}"
release_url="${RELEASE_URL:-https://github.com/${repository}/releases/tag/${release_tag}}"
dry_run="${DRY_RUN:-false}"

release_label="${release_name:-${release_tag}}"
comment="🚀 Released in [${release_label}](${release_url})."

release_tags=()
while IFS= read -r tag; do
  release_tags+=("${tag}")
done < <(
  gh api --paginate "repos/${repository}/releases?per_page=100" \
    --jq '.[] | select(.draft | not) | .tag_name'
)

prior_tag=""
for index in "${!release_tags[@]}"; do
  if [ "${release_tags[$index]}" = "${release_tag}" ]; then
    next_index=$((index + 1))
    if [ "${next_index}" -lt "${#release_tags[@]}" ]; then
      prior_tag="${release_tags[$next_index]}"
    fi
    break
  fi
done

if [ -z "${prior_tag}" ]; then
  echo "No prior release found for ${release_tag}; nothing to comment on."
  exit 0
fi

echo "Finding pull requests released between ${prior_tag} and ${release_tag}."

workdir="$(mktemp -d)"
trap 'rm -rf "${workdir}"' EXIT

compare_json="${workdir}/compare.json"
pr_numbers="${workdir}/prs.txt"
targets="${workdir}/targets.txt"

gh api "repos/${repository}/compare/${prior_tag}...${release_tag}" > "${compare_json}"

jq -r '.commits[].sha' "${compare_json}" | while IFS= read -r sha; do
  gh api "repos/${repository}/commits/${sha}/pulls" --jq '.[].number'
done | sort -n | uniq > "${pr_numbers}"

jq -r '
  .commits[].commit.message
  | scan("(?i)(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#([0-9]+)")
  | .[0]
' "${compare_json}" > "${targets}"

while IFS= read -r pr_number; do
  [ -n "${pr_number}" ] || continue

  pr_json="${workdir}/pr-${pr_number}.json"
  gh pr view "${pr_number}" \
    --repo "${repository}" \
    --json closingIssuesReferences,labels,number \
    > "${pr_json}"

  if jq -e 'any(.labels[]?; .name == "dependencies")' "${pr_json}" >/dev/null; then
    echo "Skipping dependency PR #${pr_number}."
    continue
  fi

  jq -r '.number, .closingIssuesReferences[]?.number' "${pr_json}" >> "${targets}"
done < "${pr_numbers}"

target_numbers=()
while IFS= read -r target; do
  target_numbers+=("${target}")
done < <(awk '/^[0-9]+$/ { print }' "${targets}" | sort -n | uniq)

if [ "${#target_numbers[@]}" -eq 0 ]; then
  echo "No associated issues or pull requests found; nothing to comment on."
  exit 0
fi

echo "Found ${#target_numbers[@]} issue(s) and pull request(s): ${target_numbers[*]}"

for target in "${target_numbers[@]}"; do
  if [ "${dry_run}" = "true" ]; then
    echo "Would comment on #${target}: ${comment}"
    continue
  fi

  if gh api --paginate --slurp "repos/${repository}/issues/${target}/comments?per_page=100" \
    | jq -e --arg body "${comment}" 'flatten | any(.body == $body)' >/dev/null; then
    echo "Release comment already exists on #${target}; skipping."
    continue
  fi

  gh api "repos/${repository}/issues/${target}/comments" \
    -f body="${comment}" \
    >/dev/null
  echo "Commented on #${target}."
done
