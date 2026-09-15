// The seeded admin label used the old product name. Format it for display only;
// preserve stored identities and signed audit history.
export function staffDisplayName(name: string): string {
  return name === "مسؤول سَنَد ٢" ? "مسؤول سَنَد" : name;
}
