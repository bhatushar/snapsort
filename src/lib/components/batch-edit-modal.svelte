<script lang="ts">
	import ianaTz from '$lib/iana-tz.json';
	import SearchSelect from '$lib/components/search-select.svelte';
	import IconCalendarClockSharp from '~icons/material-symbols/calendar-clock-sharp';
	import IconGlobe from '~icons/material-symbols/globe';
	import IconLocationOn from '~icons/material-symbols/location-on';
	import IconBookmarkAddSharp from '~icons/material-symbols/bookmark-add-sharp';
	import type { KeywordData } from '$lib/types';
	import { getContext, onMount } from 'svelte';
	import type { MediaCardProps } from '$lib/components/media-card.svelte';

	type BatchEditModalProps = {
		showModal: boolean;
		filesData: MediaCardProps[];
	};

	// Properties which are applied to all selected files
	type BatchData = {
		captureDate: string | null;
		timezone: string | null;
		latitude: number | null;
		longitude: number | null;
		altitude: number | null;
		keywordIds: number[];
	};

	let { showModal = $bindable(), filesData = $bindable() }: BatchEditModalProps = $props();

	const keywordCtx = getContext<KeywordData[]>('keyword-ctx');
	const batchData = $state<BatchData>({
		captureDate: null,
		timezone: null,
		latitude: null,
		longitude: null,
		altitude: null,
		keywordIds: []
	});
	let keywords = $derived(keywordCtx.filter((kw) => batchData.keywordIds.includes(kw.id)));
	let deletedKeywordIds: number[] = [];
	let keywordSelectorValue = $state('');

	onMount(() => {
		// Initialize batchData.keywordIds with common keywords across all selected files
		let commonKeywords = new Set<number>(keywordCtx.map((kw) => kw.id));
		filesData.forEach((file) => {
			if (file.isSelected) {
				const fileKeywords = new Set(file.keywordIds);
				commonKeywords = commonKeywords.intersection(fileKeywords);
			}
		});
		batchData.keywordIds = Array.from(commonKeywords);
	});
</script>

<section id="batchEditModal" class="absolute inset-0 z-20 flex flex-col bg-black/70">
	<button class="grow" aria-label="close-modal" onclick={() => (showModal = false)}></button>
	<div class="fixed inset-x-0 bottom-0 bg-white text-black">
		<!-- SECTION: Metadata form -->
		<div class="grid grid-cols-5 px-2 py-4 lg:grid-cols-10 lg:gap-4 lg:px-4 lg:py-2">
			<!-- Date Taken -->
			<label for="batchEditDateTaken" class="col-span-1 m-auto">
				<IconCalendarClockSharp />
			</label>
			<input
				type="date"
				id="batchEditDateTaken"
				name="batchEditDateTaken"
				bind:value={batchData.captureDate}
				class="col-span-4"
			/>

			<!-- Timezone -->
			<label for="batchEditTimezone" class="col-span-1 mx-auto my-auto">
				<IconGlobe class="text-black" />
			</label>
			<SearchSelect
				id="batchEditTimezone"
				class="col-span-4"
				placeholder="Timezone"
				bind:value={batchData.timezone}
				dataList={ianaTz}
				dataToDropdownMapping={(tz) => ({ value: tz.zone, label: tz.zone })}
				dataFilter={(tz) => tz.zone.toLowerCase().includes(batchData.timezone?.toLowerCase() ?? '')}
				autoSelect={true}
			/>

			<IconLocationOn class="col-span-1 mx-auto my-auto text-black" />
			<div class="col-span-4 grid grid-cols-3 lg:col-span-9">
				<!-- Latitude -->
				<input
					type="number"
					id="batchEditLatitude"
					name="batchEditLatitude"
					min={-90}
					max={90}
					bind:value={batchData.latitude}
					placeholder="Latitude"
				/>

				<!-- Longitude -->
				<input
					type="number"
					id="batchEditLongitude"
					name="batchEditLongitude"
					min={-180}
					max={180}
					bind:value={batchData.longitude}
					placeholder="Longitude"
				/>

				<!-- Altitude -->
				<input
					type="text"
					id="batchEditAltitude"
					name="batchEditAltitude"
					bind:value={batchData.altitude}
					placeholder="Altitude"
				/>
			</div>

			<!-- Keyword adder -->
			<label for="batchEditKeywords" class="col-span-1 mx-auto my-auto">
				<IconBookmarkAddSharp class="text-black" />
			</label>
			<SearchSelect
				id="batchEditKeywordSelector"
				class="col-span-4"
				placeholder="Keyword"
				bind:value={keywordSelectorValue}
				dataList={keywordCtx}
				dataToDropdownMapping={(keywordData: KeywordData) => ({
					value: keywordData.name, // Using name instead of id to display the proper value
					label: `${keywordData.name} / ${keywordData.category}`
				})}
				dataFilter={(keywordData: KeywordData) =>
					keywordData.name.toLowerCase().includes(keywordSelectorValue.toLowerCase()) ||
					keywordData.category.toLowerCase().includes(keywordSelectorValue.toLowerCase())}
				onSelect={() => {
					const keywordData = keywordCtx.find((kw) => kw.name === keywordSelectorValue);

					if (keywordData) {
						// Mark keyword as not-deleted
						deletedKeywordIds = deletedKeywordIds.filter((id) => id !== keywordData.id);

						// Add the selected keyword's ID to the list if it doesn't exist yet
						if (!batchData.keywordIds.includes(keywordData.id))
							batchData.keywordIds.push(keywordData.id);

						// Update missing GPS data if the keyword is a location
						if (keywordData.category === 'Location') {
							if (keywordData.latitude && !batchData.latitude)
								batchData.latitude = keywordData.latitude;
							if (keywordData.longitude && !batchData.longitude)
								batchData.longitude = keywordData.longitude;
							if (keywordData.altitude && !batchData.altitude)
								batchData.altitude = keywordData.altitude;
						}
					}
					keywordSelectorValue = '';
				}}
				autoSelect={true}
			/>

			<!-- Keyword remover -->
			<div class="col-span-5 mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto lg:mt-0">
				{#each keywords as keyword (keyword.id)}
					<span class="bg-black py-1 pl-3 text-sm text-white">
						{keyword.name} |<button
							class="h-full cursor-pointer pr-3 text-xs font-semibold"
							onclick={() => {
								batchData.keywordIds = batchData.keywordIds.filter((id) => id !== keyword.id);
								deletedKeywordIds.push(keyword.id);
							}}>&nbsp;X</button
						>
					</span>
				{/each}
			</div>
		</div>

		<!-- SECTION: Action buttons -->
		<div class="grid h-10 grid-cols-2">
			<!-- Save changes -->
			<button
				class="cursor-pointer bg-slate-200 py-2 text-xl text-black transition-colors hover:bg-blue-600 hover:text-white active:bg-blue-800 active:text-white"
				onclick={() => {
					filesData = filesData.map((file) => {
						if (!file.isSelected) return file;
						// Clear file selection on save
						file.isSelected = false;

						if (batchData.captureDate) file.captureDate = batchData.captureDate;
						if (batchData.timezone) file.timezone = batchData.timezone;
						if (batchData.latitude) file.latitude = batchData.latitude;
						if (batchData.longitude) file.longitude = batchData.longitude;
						if (batchData.altitude) file.altitude = batchData.altitude;

						file.keywordIds = file.keywordIds.filter((id) => !deletedKeywordIds.includes(id));
						file.keywordIds = [...file.keywordIds, ...batchData.keywordIds];
						return file;
					});
					showModal = false;
				}}
			>
				Apply
			</button>

			<!-- Discard changes -->
			<button
				class="cursor-pointer bg-black py-2 text-xl text-white transition-colors hover:bg-blue-600 hover:text-white active:bg-blue-800 active:text-white"
				onclick={() => {
					showModal = false;
				}}
			>
				Discard
			</button>
		</div>
	</div>
</section>
