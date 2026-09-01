export function transferContainsFiles(types: readonly string[]): boolean {
  return types.some((type) => type.toLowerCase() === "files");
}

export function transferContainsImage(
  files: ArrayLike<Pick<File, "type">>,
): boolean {
  for (let index = 0; index < files.length; index += 1) {
    if (files[index]?.type.toLowerCase().startsWith("image/")) return true;
  }
  return false;
}
