function ownerFilter(ownerId, additional = []) {
    if (typeof ownerId !== "string" || !ownerId) throw new Error("An authenticated owner scope is required.");
    return { must: [{ key: "ownerId", match: { value: ownerId } }, ...additional] };
}
module.exports = ownerFilter;
