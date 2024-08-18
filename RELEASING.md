# Releasing

1. Confirm that CHANGELOG.md is updated (any new changes should go under "Unreleased" at the top).
2. On the master branch, run `yarn release` and follow the prompts.
3. After a new tag is pushed from the above step, the [publish workflow](./.github/workflows/publish.yml) will automatically build & push Docker images and create a GitHub release for the tag.
