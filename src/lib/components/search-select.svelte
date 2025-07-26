<script lang="ts" generics="Data">
	import { onMount } from 'svelte';

	/**
	 * Represents an option in a dropdown menu.
	 * This type defines the structure of an object that can be used as an individual
	 * option within a dropdown selection interface.
	 */
	type DropdownOption = {
		// A unique identifier for the dropdown option, which can be either a string or a number.
		value: string | number;
		// A human-readable text label representing the dropdown option to the user.
		label: string;
	};

	/**
	 * Defines the properties for a SearchSelect component.
	 */
	type SearchSelectProps = {
		// Specifies the unique identifier for the SearchSelect component.
		id: string;
		// Binds to the text input value of the SearchSelect component.
		value: string | number | null;
		// Provides the list of data items to be displayed as available options in the dropdown.
		dataList: Data[];
		// A function that defines how data from the `dataList` is transformed into a format suitable for the dropdown options.
		dataToDropdownMapping: (data: Data) => DropdownOption;
		// A function to filter the data in the `dataList` based on `value`.
		dataFilter: (data: Data) => boolean;
		// An optional function to specify the sorting logic for the data displayed in the dropdown.
		dataSort?: (data1: Data, data2: Data) => number;
		// An optional callback function executed when an option is selected.
		onSelect?: () => void;
		// Enables auto-selecting if only one option matches the query.
		autoSelect: boolean;
		// An optional string to specify the CSS class for custom styling of the SearchSelect component.
		class?: string;
		placeholder?: string;
	};

	let {
		id,
		value = $bindable(),
		dataList,
		dataToDropdownMapping,
		dataFilter,
		dataSort,
		onSelect,
		autoSelect,
		class: className,
		placeholder
	}: SearchSelectProps = $props();

	/**
	 * A state variable representing whether a dropdown menu is visible or not.
	 */
	let showDropdown = $state(false);

	/**
	 * Represents the options available for a dropdown menu.
	 * The options are derived from a filtered and mapped list of data items.
	 */
	let dropdownOpts: DropdownOption[] = $state(
		dataList.filter(dataFilter).map(dataToDropdownMapping)
	);

	/**
	 * Update the dropdown list when the input value changes, with a delay of 500 ms
	 */
	const updateDropdownList = (() => {
		let filterTimer: ReturnType<typeof setTimeout>;
		return () => {
			clearTimeout(filterTimer);
			filterTimer = setTimeout(() => {
				dropdownOpts = dataSort
					? dataList.filter(dataFilter).sort(dataSort).map(dataToDropdownMapping)
					: (dropdownOpts = dataList.filter(dataFilter).map(dataToDropdownMapping));
			}, 500);
		};
	})();

	onMount(updateDropdownList);
</script>

<div
	class="relative {className}"
	onfocusout={({ currentTarget, relatedTarget }) => {
		// Adding focusout handler here to prevent dropdown from closing when clicking on an option.
		if (relatedTarget instanceof HTMLElement && currentTarget.contains(relatedTarget)) return;

		showDropdown = false;
		// When the user is leaving, autoselect if only one option is matching.
		if (autoSelect && dropdownOpts.length === 1) {
			value = dropdownOpts[0].value;
			if (onSelect) onSelect();
			updateDropdownList();
		}
	}}
>
	<!-- Search text input -->
	<input
		type="text"
		{id}
		bind:value
		class="w-full"
		{placeholder}
		onfocusin={() => {
			showDropdown = true;
		}}
		onkeyup={() => {
			updateDropdownList();
			showDropdown = true;
		}}
		onkeydown={(event) => {
			if (event.key === 'Enter' && dropdownOpts.length > 0) {
				value = dropdownOpts[0].value;
				showDropdown = false;
				if (onSelect) onSelect();
				updateDropdownList();
			}
		}}
	/>

	<!-- Search results -->
	<div
		class="{!showDropdown
			? 'hidden'
			: ''} absolute inset-x-0 z-20 flex max-h-36 flex-col overflow-y-scroll border-r border-l border-gray-500 bg-white"
	>
		{#each dropdownOpts as option (option.value)}
			<button
				type="button"
				value={option.value}
				class="grow cursor-pointer border-b border-gray-500 px-2 py-1 text-left text-wrap hover:bg-gray-100"
				onclick={() => {
					value = option.value;
					showDropdown = false;
					if (onSelect) onSelect();
					updateDropdownList();
				}}
			>
				{option.label}
			</button>
		{/each}
	</div>
</div>
