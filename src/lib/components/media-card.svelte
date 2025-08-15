<script lang="ts">
	import type { KeywordData } from '$lib/types';
	import SearchSelect from '$lib/components/search-select.svelte';
	import ianaTz from '$lib/iana-tz.json';
	import { getContext } from 'svelte';
	import IconCalendarClockSharp from '~icons/material-symbols/calendar-clock-sharp';
	import IconGlobe from '~icons/material-symbols/globe';
	import IconLocationOn from '~icons/material-symbols/location-on';
	import IconTitle from '~icons/material-symbols/title';
	import IconBookmarkAddSharp from '~icons/material-symbols/bookmark-add-sharp';
	import IconAlarmOutline from '~icons/material-symbols/alarm-outline';
	import IconClose from '~icons/material-symbols/close';

	export type MediaCardProps = {
		id: number;
		name: string;
		thumbnailPath: string;
		captureDate: string | null;
		captureTime: string | null;
		timezone: string;
		title: string | null;
		latitude: number | null;
		longitude: number | null;
		altitude: number | null;
		keywordIds: number[];
		markedForDeletion: boolean;
		isSelected: boolean;
	};

	let {
		id,
		name,
		thumbnailPath,
		captureDate = $bindable(),
		captureTime = $bindable(),
		timezone = $bindable(),
		title = $bindable(),
		latitude = $bindable(),
		longitude = $bindable(),
		altitude = $bindable(),
		keywordIds = $bindable(),
		markedForDeletion = $bindable(),
		isSelected = $bindable()
	}: MediaCardProps = $props();

	const keywordCtx = getContext<KeywordData[]>('keyword-ctx');
	// All keyword data specific to this file
	let keywords = $derived(keywordCtx.filter((kw) => keywordIds.includes(kw.keywordId)));
	let keywordSelectorValue = $state('');
</script>

<div class="m-y-2 bg-white text-black {isSelected ? 'ring-4 ring-blue-500' : ''}">
	<!-- SECTION: Image container -->
	<section
		class="relative h-96 bg-slate-200 transition-colors hover:bg-slate-300 active:bg-slate-400"
	>
		<label for="{id}_select" class="cursor-pointer">
			<img src={thumbnailPath} alt="Load fail" class="mx-auto h-full object-contain" />
		</label>
		<!-- Checkbox -->
		<input
			type="checkbox"
			id="{id}_select"
			class="absolute top-2 left-2 {!isSelected ? 'hidden' : ''}"
			bind:checked={isSelected}
			onchange={({ currentTarget }) => {
				isSelected = currentTarget.checked;
			}}
		/>
		<!-- Delete button -->
		<button
			class="absolute top-0 right-0 cursor-pointer"
			onclick={() => {
				isSelected = false;
				markedForDeletion = true;
			}}
		>
			<IconClose
				class="h-8 w-8 bg-black p-1 text-white transition-colors hover:bg-red-500 active:bg-red-800"
			/>
		</button>
	</section>

	<!-- SECTION: Metadata form -->
	<section class="px-2 py-2">
		<h2 class="px-2 pb-1 text-lg font-semibold">{name}</h2>
		<div class="grid grid-cols-9">
			<!-- Date -->
			<label for="{id}_dateTaken" class="col-span-1 mx-auto my-auto">
				<IconCalendarClockSharp class="text-black" />
			</label>
			<input
				type="date"
				id="{id}_dateTaken"
				name="{id}_dateTaken"
				bind:value={captureDate}
				placeholder="YYYY-DD-MM"
				class="col-span-8"
			/>

			<!-- Time -->
			<label for="{id}_timeTaken" class="col-span-1 mx-auto my-auto">
				<IconAlarmOutline class="text-black" />
			</label>
			<input
				type="time"
				step="1"
				id="{id}_timeTaken"
				name="{id}_timeTaken"
				bind:value={captureTime}
				placeholder="HH:MM:SS"
				class="col-span-8"
			/>

			<!-- Timezone -->
			<label for="{id}_timezone" class="col-span-1 mx-auto my-auto">
				<IconGlobe class="text-black" />
			</label>
			<SearchSelect
				id="{id}_timezone"
				class="col-span-8"
				placeholder="Timezone"
				bind:value={timezone}
				dataList={ianaTz}
				dataToDropdownMapping={(tz) => ({ value: tz.zone, label: tz.zone })}
				dataFilter={(tz) => tz.zone.toLowerCase().includes(timezone?.toLowerCase() ?? '')}
				autoSelect={true}
			/>

			<!-- Title -->
			<label for="{id}_title" class="col-span-1 mx-auto my-auto">
				<IconTitle class="text-black" />
			</label>
			<input
				type="text"
				id="{id}_title"
				name="{id}_title"
				bind:value={title}
				placeholder="Title"
				class="col-span-8"
			/>

			<IconLocationOn class="col-span-1 mx-auto my-auto text-black" />
			<div class="col-span-8 grid grid-cols-3">
				<!-- Latitude -->
				<input
					type="number"
					id="{id}_latitude"
					name="{id}_latitude"
					min={-90}
					max={90}
					bind:value={latitude}
					placeholder="Latitude"
					class=""
				/>

				<!-- Longitude -->
				<input
					type="number"
					id="{id}_longitude"
					name="{id}_longitude"
					min={-180}
					max={180}
					bind:value={longitude}
					placeholder="Longitude"
					class=""
				/>

				<!-- Altitude -->
				<input
					type="text"
					id="{id}_altitude"
					name="{id}_altitude"
					bind:value={altitude}
					placeholder="Altitude"
					class=""
				/>
			</div>

			<!-- Keyword selector -->
			<label for="{id}_keywordSelector" class="col-span-1 mx-auto my-auto">
				<IconBookmarkAddSharp class="text-black" />
			</label>
			<SearchSelect
				id="{id}_keywordSelector"
				class="col-span-8"
				placeholder="Keyword"
				bind:value={keywordSelectorValue}
				dataList={keywordCtx}
				dataToDropdownMapping={(keywordData: KeywordData) => ({
					value: keywordData.keyword, // Using name instead of id to display the proper value
					label: `${keywordData.keyword} / ${keywordData.category}`
				})}
				dataFilter={(keywordData: KeywordData) =>
					keywordData.keyword.toLowerCase().includes(keywordSelectorValue.toLowerCase()) ||
					keywordData.category.toLowerCase().includes(keywordSelectorValue.toLowerCase())}
				onSelect={() => {
					// Add the selected keyword's ID to the list if it doesn't exist yet
					const keywordData = keywordCtx.find((kw) => kw.keyword === keywordSelectorValue);
					if (keywordData) {
						if (!keywordIds.includes(keywordData.keywordId)) keywordIds.push(keywordData.keywordId);
						// Update missing GPS data if the keyword is a location
						if (keywordData.category === 'Location') {
							if (keywordData.latitude && !latitude) latitude = keywordData.latitude;
							if (keywordData.longitude && !longitude) longitude = keywordData.longitude;
							if (keywordData.altitude && !altitude) altitude = keywordData.altitude;
						}
					}
					keywordSelectorValue = '';
				}}
				autoSelect={true}
			/>
		</div>

		<!-- Keyword list -->
		<div class="mt-2 flex flex-wrap gap-2">
			{#each keywords as keyword (keyword.keywordId)}
				<span class="bg-black py-1 pl-3 text-sm text-white">
					{keyword.keyword} |<button
						class="h-full cursor-pointer pr-3 text-xs font-semibold"
						onclick={() => (keywordIds = keywordIds.filter((id) => id !== keyword.keywordId))}
						>&nbsp;X</button
					>
				</span>
			{/each}
		</div>
	</section>
</div>
