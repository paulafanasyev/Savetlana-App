/**
 * Path containment check for the local storage reader (audit: storage
 * traversal). `abs.startsWith(root)` is not enough: "/data/uploads-evil"
 * starts with "/data/uploads". A path is inside the root only when the
 * relative path from root does not climb out and is not absolute.
 */
import path from "node:path";

export function isPathWithinRoot(root: string, abs: string): boolean {
  const relative = path.relative(root, abs);
  if (relative === "") return true;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
