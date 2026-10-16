// Whether an adoption left the catalogue as asked, read from the result's
// own entries: something was written or found identical, and nothing was
// refused or left in conflict. A failed write moves its surfaces to rejected,
// and a selection that yields no registration leaves both lists empty.
export function adoptionAccepted(result) {
	const stood = result.imported.length + result.unchanged.length;
	const refused = result.conflicting.length + result.rejected.length;
	return Boolean(stood) && !refused;
}
