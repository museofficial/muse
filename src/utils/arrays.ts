export const chunk = <T>(arr: T[], len: number) => {
  const chunks = [];

  let i = 0;
  while (i < arr.length) {
    chunks.push(arr.slice(i, i += len));
  }

  return chunks;
};
