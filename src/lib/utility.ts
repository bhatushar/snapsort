/**
 * A value is considered set if it's not undefined/null,
 * and not an empty string, and not an empty array.
 *
 * @param value
 */
export const isValueSet = (value: unknown) =>
	!(
		value === undefined ||
		value === null ||
		value === '' ||
		(Array.isArray(value) && value.length === 0)
	);

/**
 * Array filter predicate to remove duplicate entries.
 * Only compatible with array element types which are comparable with equality operator.
 *
 * @param value Value in the array
 * @param index Index of {@link value} in the array
 * @param array Reference to the parent array
 * @returns Array with only unique values
 */
export const removeDuplicatesPredicate = <T>(value: T, index: number, array: T[]) => {
	return array.indexOf(value) === index;
};
