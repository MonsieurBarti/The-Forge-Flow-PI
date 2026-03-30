const SKIP_EXTENSIONS = [".md", ".spec.ts", ".test.ts"];
const SKIP_DIRS = ["__fixtures__", "__mocks__", "fixtures"];
const MAX_FILE_SIZE = 512 * 1024; // 512KB

export function shouldSkipFile(filePath: string): boolean {
  if (SKIP_EXTENSIONS.some((ext) => filePath.endsWith(ext))) return true;
  if (SKIP_DIRS.some((dir) => filePath.includes(`/${dir}/`))) return true;
  return false;
}

export function shouldSkipContent(content: string): boolean {
  return content.length > MAX_FILE_SIZE;
}
