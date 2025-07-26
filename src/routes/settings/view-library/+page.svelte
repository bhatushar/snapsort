<script lang="ts">
	import type { PageProps } from './$types';
	import { DateTime } from 'luxon';

	const { data }: PageProps = $props();
	let { libraryFiles } = $derived(data);

	const formatDateTime = (dateTime: Date, timezone: string) =>
		DateTime.fromJSDate(dateTime).setZone(timezone).toFormat('yyyy-MM-dd HH:mm:ss');

	const formatLatitude = (latitude: number | null) => {
		if (latitude === null) return '';
		return `${latitude} ${latitude >= 0 ? 'N' : 'S'}`;
	};

	const formatLongitude = (longitude: number | null) => {
		if (longitude === null) return '';
		return `${longitude} ${longitude >= 0 ? 'E' : 'W'}`;
	};

	const formatKeywords = (keywords: string[] | [null]) =>
		keywords.filter((kw) => kw !== null).join('; ');
</script>

<svelte:head>
	<title>SnapSort - Library</title>
</svelte:head>

<section class="flex h-screen flex-col justify-between">
	<!-- SECTION: Header -->
	<nav class="sticky top-0 z-10 flex h-16 items-center justify-between bg-black px-5 py-1">
		<!-- Logo -->
		<a href="/"><img alt="Snap Sort logo" src="/logo.svg" class="w-20" /></a>
	</nav>

	<!-- SECTION: Files table -->
	<div class="h-full w-full overflow-auto">
		<table class="relative table-fixed bg-white text-black">
			<thead class="sticky top-0">
				<tr class="bg-slate-200">
					<th class="px-2">Name</th>
					<th class="px-2">Path</th>
					<th class="px-2">Capture Date</th>
					<th class="px-2">Capture Timezone</th>
					<th class="px-2">Title</th>
					<th class="px-2">Latitude</th>
					<th class="px-2">Longitude</th>
					<th class="px-2">Altitude</th>
					<th class="px-2">Keywords</th>
				</tr>
			</thead>
			<tbody class="text-nowrap">
				{#each libraryFiles as file (file.id)}
					<tr>
						<td class="border-2 border-gray-300 px-2">{file.name}</td>
						<td class="border-2 border-gray-300 px-2">{file.path}</td>
						<td class="border-2 border-gray-300 px-2">
							{formatDateTime(file.captureDateTime, file.timezone)}
						</td>
						<td class="border-2 border-gray-300 px-2">{file.timezone}</td>
						<td class="border-2 border-gray-300 px-2">{file.title}</td>
						<td class="border-2 border-gray-300 px-2">
							{formatLatitude(file.latitude)}
						</td>
						<td class="border-2 border-gray-300 px-2">
							{formatLongitude(file.longitude)}
						</td>
						<td class="border-2 border-gray-300 px-2">{file.altitude ?? ''}</td>
						<td class="border-2 border-gray-300 px-2">
							{formatKeywords(file.keywords)}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
