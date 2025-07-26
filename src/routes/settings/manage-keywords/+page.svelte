<script lang="ts">
	import IconNewLabelOutlineSharp from '~icons/material-symbols/new-label-outline-sharp';
	import IconClose from '~icons/material-symbols/close';
	import SearchSelect from '$lib/components/search-select.svelte';
	import type { KeywordCategory } from '$lib/types';
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { removeDuplicatesPredicate } from '$lib/utility';
	import Loader from '$lib/components/loader.svelte';

	const { data, form }: PageProps = $props();
	let { keywords, locations } = $derived(data);

	let showErrorsModal = $derived<boolean>((form?.errors?.length ?? 0) !== 0);
	let showAddKeywordModal = $state(false);

	// Reactive data for new keyword being added
	let newKeywordData = $state({
		category: 'Location',
		city: '',
		state: '',
		country: ''
	});

	const keywordCategories: KeywordCategory[] = [
		'Album',
		'Group',
		'Location',
		'Person',
		'Animal',
		'Other'
	] as const;

	let loadingState = $state(false);
</script>

<svelte:head>
	<title>SnapSort - Keywords</title>
</svelte:head>

<section class="flex h-screen flex-col justify-between">
	{#if loadingState}
		<Loader />
	{/if}

	<!-- SECTION: Header -->
	<nav class="sticky top-0 z-10 flex h-16 items-center justify-between bg-black px-5 py-1">
		<!-- Logo -->
		<a href="/"><img alt="Snap Sort logo" src="/logo.svg" class="w-20" /></a>

		<div class="flex items-center justify-between gap-x-4">
			<!-- Add new keyword button -->
			<button class="cursor-pointer" onclick={() => (showAddKeywordModal = true)}>
				<IconNewLabelOutlineSharp
					class="text-2xl text-white transition hover:text-blue-600 active:text-blue-800"
				/>
			</button>
		</div>
	</nav>

	<!-- SECTION: Keyword table -->
	<div class="h-full overflow-auto">
		<table class="relative table-fixed bg-white text-black">
			<thead class="sticky top-0">
				<tr class="bg-slate-200">
					<th class="px-2">Keyword</th>
					<th class="px-2">Category</th>
					<th class="px-2">Folder Label</th>
					<th class="px-2">City</th>
					<th class="px-2">State</th>
					<th class="px-2">Country</th>
					<th class="px-2">Latitude</th>
					<th class="px-2">Longitude</th>
					<th class="px-2">Altitude</th>
				</tr>
			</thead>
			<tbody class="text-nowrap">
				{#each keywords as keyword (keyword.keyword)}
					<tr>
						<td class="border-2 border-gray-300 px-2">{keyword.keyword}</td>
						<td class="border-2 border-gray-300 px-2">{keyword.category}</td>
						<td
							class={`border-2 border-gray-300 px-2 ${keyword.isFolderLabel ? 'bg-green-100' : 'bg-red-100'}`}
							>{keyword.isFolderLabel ? 'Yes' : 'No'}</td
						>
						<td class="border-2 border-gray-300 px-2">{keyword.city ?? ''}</td>
						<td class="border-2 border-gray-300 px-2">{keyword.state ?? ''}</td>
						<td class="border-2 border-gray-300 px-2">{keyword.country ?? ''}</td>
						<td class="border-2 border-gray-300 px-2">{keyword.latitude ?? ''}</td>
						<td class="border-2 border-gray-300 px-2">{keyword.longitude ?? ''}</td>
						<td class="border-2 border-gray-300 px-2">{keyword.altitude ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

<!-- SECTION: Modals -->

<!-- Add new keyword modal -->
{#if showAddKeywordModal}
	<section class="fixed inset-0 z-50 flex flex-col">
		<!-- Close modal if clicked here -->
		<button
			aria-label="close-add-keyword-modal"
			class="grow bg-black/70"
			onclick={() => (showAddKeywordModal = false)}
		></button>

		<div class="bg-white px-4 py-2 text-black">
			<!-- Modal header -->
			<div class="mb-2 flex justify-between">
				<span class="text-xl font-bold">Add Keyword</span>
				<button
					onclick={() => (showAddKeywordModal = false)}
					class="cursor-pointer text-xl font-bold"
				>
					<IconClose />
				</button>
			</div>

			<!-- Add keyword form -->
			<form
				method="POST"
				action="?/addKeyword"
				use:enhance={() => {
					loadingState = true;
					return async ({ update }) => {
						await update();
						loadingState = false;
					};
				}}
				class="grid grid-cols-6 items-center gap-4 lg:grid-cols-12"
			>
				<!-- Keyword name -->
				<label for="keyword" class="col-span-2 lg:col-span-1">Keyword:</label>
				<input type="text" name="keyword" id="keyword" class="col-span-4 lg:col-span-4" />

				<!-- Category -->
				<label for="category" class="col-span-2 lg:col-span-1">Category:</label>
				<select
					name="category"
					id="category"
					class="col-span-4 lg:col-span-4"
					bind:value={newKeywordData.category}
				>
					{#each keywordCategories as category (category)}
						<option value={category}>{category}</option>
					{/each}
				</select>

				<!-- Folder Label -->
				<div class="col-span-6 flex items-center gap-x-2 lg:col-span-2">
					<input type="checkbox" name="isFolderLabel" id="isFolderLabel" />
					<label for="isFolderLabel">Folder Label</label>
				</div>

				<!-- Location specific attributes -->
				{#if newKeywordData.category === 'Location'}
					<!-- City -->
					<label for="citySelect" class="col-span-2 lg:col-span-1">City:</label>
					<SearchSelect
						id="citySelect"
						class="col-span-4 lg:col-span-3"
						bind:value={newKeywordData.city}
						dataList={locations.cities}
						dataToDropdownMapping={(city) => ({ value: city.name, label: city.name })}
						dataFilter={(city) =>
							city.name.toLowerCase().includes(newKeywordData.city.toLowerCase())}
						autoSelect={false}
					/>
					<input type="text" name="city" id="city" hidden bind:value={newKeywordData.city} />

					<!-- State -->
					<label for="stateSelect" class="col-span-2 lg:col-span-1">State:</label>
					<SearchSelect
						id="stateSelect"
						class="col-span-4 lg:col-span-3"
						bind:value={newKeywordData.state}
						dataList={locations.states}
						dataToDropdownMapping={(state) => ({ value: state.name, label: state.name })}
						dataFilter={(state) =>
							state.name.toLowerCase().includes(newKeywordData.state.toLowerCase())}
						autoSelect={false}
					/>
					<input type="text" name="state" id="state" hidden bind:value={newKeywordData.state} />

					<!-- Country -->
					<label for="countrySelect" class="col-span-2 lg:col-span-1">Country:</label>
					<SearchSelect
						id="countrySelect"
						class="col-span-4 lg:col-span-3"
						bind:value={newKeywordData.country}
						dataList={locations.countries}
						dataToDropdownMapping={(country) => ({ value: country.name, label: country.name })}
						dataFilter={(country) =>
							country.name.toLowerCase().includes(newKeywordData.country.toLowerCase())}
						autoSelect={false}
					/>
					<input
						type="text"
						name="country"
						id="country"
						hidden
						bind:value={newKeywordData.country}
					/>

					<!-- Latitude -->
					<label for="latitude" class="col-span-2 lg:col-span-1">Latitude:</label>
					<input
						type="number"
						min="-90"
						max="90"
						name="latitude"
						id="latitude"
						class="col-span-4 lg:col-span-3"
					/>

					<!-- Longitude -->
					<label for="longitude" class="col-span-2 lg:col-span-1">Longitude:</label>
					<input
						type="number"
						min="-180"
						max="180"
						name="longitude"
						id="longitude"
						class="col-span-4 lg:col-span-3"
					/>

					<!-- Altitude -->
					<label for="altitude" class="col-span-2 lg:col-span-1">Altitude:</label>
					<input type="number" name="altitude" id="altitude" class="col-span-4 lg:col-span-3" />
				{/if}

				<!-- Submit -->
				<input
					type="submit"
					value="Add"
					class="col-span-full cursor-pointer bg-black py-2 text-white transition hover:bg-blue-600 active:bg-blue-800"
				/>
			</form>
		</div>
	</section>
{/if}

<!-- Form errors -->
{#if showErrorsModal}
	<section class="fixed inset-0 z-50 flex flex-col">
		<button
			aria-label="close-errors-modal"
			class="grow bg-black/70"
			onclick={() => (showErrorsModal = false)}
		></button>
		<div class="bg-red-200 px-4 py-2 text-red-950">
			<div class="mb-2 flex justify-between">
				<span class="text-xl font-bold">Something went wrong:</span>
				<button onclick={() => (showErrorsModal = false)} class="cursor-pointer text-xl font-bold">
					<IconClose />
				</button>
			</div>
			<hr />
			<ul class="mt-2 px-2">
				{#each form?.errors?.filter(removeDuplicatesPredicate) ?? [] as error, i (i)}
					<li class="my-2">{error}</li>
				{/each}
			</ul>
		</div>
	</section>
{/if}
