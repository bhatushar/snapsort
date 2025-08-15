<script lang="ts">
	import { enhance } from '$app/forms';
	import IconUploadSharp from '~icons/material-symbols/upload-sharp';
	import IconSettingsOutline from '~icons/material-symbols/settings-outline';
	import IconEditSquareOutlineSharp from '~icons/material-symbols/edit-square-outline-sharp';
	import IconSaveSharp from '~icons/material-symbols/save-sharp';
	import IconCheckBoxSharp from '~icons/material-symbols/check-box-sharp';
	import IconDriveFileMoveSharp from '~icons/material-symbols/drive-file-move-sharp';
	import MediaCard, { type MediaCardProps } from '$lib/components/media-card.svelte';
	import BatchEditModal from '$lib/components/batch-edit-modal.svelte';
	import type { QueuedFileData } from '$lib/types';
	import { setContext } from 'svelte';
	import Loader from '$lib/components/loader.svelte';
	import NoticeModal from '$lib/components/notice-modal.svelte';
	import type { PageProps } from './$types';
	import { isValueSet } from '$lib/utility';
	import { DateTime } from 'luxon';

	let { data, form }: PageProps = $props();

	/**
	 * Convert queued file data provided by the server into a format compatible with the media card.
	 *
	 * @param queuedFile Queued file data from server.
	 * @returns Media card data.
	 */
	const convertQueuedFileToMediaCard = (queuedFile: QueuedFileData): MediaCardProps => {
		let captureDate: string | null = null;
		let captureTime: string | null = null;

		// Split date and time into separate properties
		if (queuedFile.captureDateTime) {
			const luxonDateTime = queuedFile.timezone
				? DateTime.fromJSDate(queuedFile.captureDateTime).setZone(queuedFile.timezone)
				: DateTime.fromJSDate(queuedFile.captureDateTime);
			captureDate = luxonDateTime.toFormat('yyyy-MM-dd');
			captureTime = luxonDateTime.toFormat('HH:mm:ss');
		}

		return {
			...queuedFile,
			captureDate,
			captureTime,
			markedForDeletion: false,
			isSelected: false
		};
	};

	let mediaCardData = $state<MediaCardProps[]>(data.queuedFiles.map(convertQueuedFileToMediaCard));
	// Update state whenever the server updates data
	$effect(() => {
		mediaCardData = data.queuedFiles.map(convertQueuedFileToMediaCard);
	});

	setContext('keyword-ctx', data.keywordCtx);

	// UI states
	let showLoader = $state(false);
	let showBatchEditModal = $state(false);
	let showSaveModal = $state(false);
	let areAllFilesSelected = $derived(mediaCardData.every((file) => file.isSelected));

	/**
	 * Binds to the file-upload form
	 */
	let uploadFilesForm: HTMLFormElement;
</script>

<svelte:head>
	<title>SnapSort</title>
</svelte:head>

<section class="flex h-screen flex-col justify-between">
	<Loader {showLoader} />

	<!-- SECTION: Header -->
	<nav class="sticky top-0 z-10 flex h-16 items-center justify-between bg-black px-5 py-1">
		<!-- Logo -->
		<a href="/"><img alt="Snap Sort logo" src="/logo.svg" class="w-20" /></a>

		<div class="flex items-center justify-between gap-x-4">
			{#if mediaCardData.some((queuedFile) => queuedFile.isSelected)}
				<input
					type="checkbox"
					bind:checked={areAllFilesSelected}
					onclick={(event) => {
						mediaCardData.forEach((queuedFile) => {
							if (event.target instanceof HTMLInputElement) {
								queuedFile.isSelected = event.target?.checked;
							}
						});
					}}
				/>
			{/if}
			<!-- Upload file form -->
			<div class="hidden">
				<form
					action="?/uploadFiles"
					method="post"
					use:enhance={() => {
						showLoader = true;
						return async ({ update }) => {
							await update();
							showLoader = false;
						};
					}}
					enctype="multipart/form-data"
					id="fileUploadForm"
					bind:this={uploadFilesForm}
				>
					<!--
						Use generic file type, instead of narrowing to images/videos.
						Otherwise, mobile browsers are removing GPS data from selected files.
						BUG: On Android, if files are not selected with default file picker (and
						are instead selected with Gallery etc.) then the GPS data is still stripped.
					 -->
					<input
						type="file"
						name="uploadedFiles"
						id="uploadedFiles"
						class="hidden"
						multiple
						required
						onchange={() => {
							// loadingState = true;
							uploadFilesForm.requestSubmit();
						}}
					/>
				</form>
			</div>
			<!-- Upload file button -->
			<label id="uploadedFilesLabelNav" for="uploadedFiles" class="cursor-pointer">
				<IconUploadSharp
					class="text-2xl text-white transition hover:text-blue-600 active:text-blue-800"
				/>
			</label>

			<!-- Settings page button -->
			<a href="/settings" class="cursor-pointer">
				<IconSettingsOutline
					class="text-2xl text-white transition hover:text-blue-600 active:text-blue-800"
				/>
			</a>
		</div>
	</nav>

	<!-- SECTION: Media cards -->
	<section
		class="grid grow grid-cols-1 gap-4 overflow-auto px-5 py-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6"
	>
		{#if mediaCardData.length}
			{#each mediaCardData as _, i (i)}
				{#if !mediaCardData[i].markedForDeletion}
					<MediaCard
						id={mediaCardData[i].id}
						name={mediaCardData[i].name}
						thumbnailPath={`/api/thumbnail/${mediaCardData[i].id}`}
						bind:captureDate={mediaCardData[i].captureDate}
						bind:captureTime={mediaCardData[i].captureTime}
						bind:timezone={mediaCardData[i].timezone}
						bind:title={mediaCardData[i].title}
						bind:latitude={mediaCardData[i].latitude}
						bind:longitude={mediaCardData[i].longitude}
						bind:altitude={mediaCardData[i].altitude}
						bind:keywordIds={mediaCardData[i].keywordIds}
						bind:markedForDeletion={mediaCardData[i].markedForDeletion}
						bind:isSelected={mediaCardData[i].isSelected}
					/>
				{/if}
			{/each}
		{:else}
			<div
				class="col-span-full flex flex-col items-center gap-1 self-center justify-self-center text-3xl text-gray-500"
			>
				<label id="uploadedFilesLabelBody" for="uploadedFiles" class="cursor-pointer">
					<IconUploadSharp class="h-28 w-28" />
				</label>
				<span class="text-center">Upload some files to get started!</span>
			</div>
		{/if}
	</section>

	<!-- SECTION: Footer -->
	{#if mediaCardData.length}
		<footer class="sticky bottom-0 z-10 bg-black">
			{#if mediaCardData.some((queuedFile) => queuedFile.isSelected)}
				<!-- Update metadata for multiple selected files at once -->
				<button
					class="flex h-10 w-full cursor-pointer items-center justify-center gap-1 bg-blue-600 py-2 text-xl text-white transition-colors hover:bg-blue-700 active:bg-blue-800"
					onclick={() => (showBatchEditModal = true)}
				>
					Edit <IconEditSquareOutlineSharp />
				</button>
			{:else}
				<!-- Save changes to server -->
				<button
					class="flex h-10 w-full cursor-pointer items-center justify-center gap-1 bg-slate-100 py-2 text-xl text-black transition-colors hover:bg-blue-700 hover:text-white active:bg-blue-800 active:text-white"
					onclick={() => (showSaveModal = true)}
				>
					Save <IconSaveSharp />
				</button>
			{/if}
		</footer>
	{/if}
</section>

<!-- SECTION: Dialog modals -->

<!-- Form result -->
<NoticeModal modalType="error" messages={form?.errors ?? []} />
<NoticeModal modalType="success" messages={form?.messages ?? []} />

<!-- Wrap in if-guard here to ensure onMount is triggered every time modal is opened -->
<BatchEditModal bind:showModal={showBatchEditModal} bind:filesData={mediaCardData} />

{#if showSaveModal}
	<!-- Save action items -->
	<section class="fixed inset-0 z-50 flex flex-col">
		<button
			aria-label="close-save-modal"
			class="grow bg-black/70"
			onclick={() => (showSaveModal = false)}
		></button>
		<!-- If all files are deleted, there's nothing to commit to library -->
		{#if mediaCardData.some(({ markedForDeletion }) => !markedForDeletion)}
			<form
				action="?/commitFiles"
				method="POST"
				class="w-full"
				use:enhance={({ formData }) => {
					showLoader = true;
					const fileChanges = mediaCardData
						.filter((metadata) => !metadata.markedForDeletion)
						.map((metadata) => ({
							id: metadata.id,
							/*
							 * Normalize all unset values to null. However, some of these values should not be null
							 * when committing files to the library. But I have offloaded all validation logic to
							 * the server for now.
							 */
							captureDate: isValueSet(metadata.captureDate) ? metadata.captureDate : null,
							captureTime: isValueSet(metadata.captureTime) ? metadata.captureTime : null,
							timezone: isValueSet(metadata.timezone) ? metadata.timezone : null,
							title: isValueSet(metadata.title) ? metadata.title : null,
							latitude: isValueSet(metadata.latitude) ? metadata.latitude : null,
							longitude: isValueSet(metadata.longitude) ? metadata.longitude : null,
							altitude: isValueSet(metadata.altitude) ? metadata.altitude : null,
							keywordIds: isValueSet(metadata.keywordIds) ? metadata.keywordIds : []
						}));

					const deletedFileIds = mediaCardData
						.filter((metadata) => metadata.markedForDeletion)
						.map((metadata) => metadata.id);

					formData.append('fileChanges', JSON.stringify(fileChanges));
					formData.append('deletedFiles', JSON.stringify({ ids: deletedFileIds }));
					showSaveModal = false;

					return async ({ update }) => {
						await update();
						showLoader = false;
					};
				}}
			>
				<button
					class="flex h-10 w-full cursor-pointer items-center justify-center gap-1 bg-white py-2 text-xl text-black transition-colors hover:bg-blue-600 hover:text-white active:bg-blue-800 active:text-white"
				>
					Move to library <IconDriveFileMoveSharp />
				</button>
			</form>
		{/if}
		<form
			action="?/modifyFiles"
			method="POST"
			class="w-full"
			use:enhance={({ formData }) => {
				showLoader = true;
				const fileChanges = mediaCardData
					.filter((metadata) => !metadata.markedForDeletion)
					.map((metadata) => ({
						id: metadata.id,
						// Normalize all unset values
						captureDate: isValueSet(metadata.captureDate) ? metadata.captureDate : null,
						captureTime: isValueSet(metadata.captureTime) ? metadata.captureTime : null,
						timezone: isValueSet(metadata.timezone) ? metadata.timezone : null,
						title: isValueSet(metadata.title) ? metadata.title : null,
						latitude: isValueSet(metadata.latitude) ? metadata.latitude : null,
						longitude: isValueSet(metadata.longitude) ? metadata.longitude : null,
						altitude: isValueSet(metadata.altitude) ? metadata.altitude : null,
						keywordIds: isValueSet(metadata.keywordIds) ? metadata.keywordIds : []
					}));

				const deletedFileIds = mediaCardData
					.filter((metadata) => metadata.markedForDeletion)
					.map((metadata) => metadata.id);

				formData.append('fileChanges', JSON.stringify(fileChanges));
				formData.append('deletedFiles', JSON.stringify({ ids: deletedFileIds }));
				showSaveModal = false;
				return async ({ update }) => {
					await update();
					showLoader = false;
				};
			}}
		>
			<button
				type="submit"
				class="flex h-10 w-full cursor-pointer items-center justify-center gap-1 bg-black py-2 text-xl text-white transition-colors hover:bg-blue-600 hover:text-white active:bg-blue-800 active:text-white"
			>
				Apply changes <IconCheckBoxSharp />
			</button>
		</form>
	</section>
{/if}
