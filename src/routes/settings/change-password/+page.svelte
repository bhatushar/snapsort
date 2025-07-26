<script lang="ts">
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { removeDuplicatesPredicate } from '$lib/utility';
	import IconClose from '~icons/material-symbols/close';
	import Loader from '$lib/components/loader.svelte';

	let { form }: PageProps = $props();
	let showErrorsModal = $derived<boolean>((form?.errors?.length ?? 0) !== 0);
	let showSuccessModal = $derived<boolean>((form?.messages?.length ?? 0) !== 0);
	let loadingState = $state(false);
</script>

<svelte:head>
	<title>SnapSort - Change Password</title>
</svelte:head>

<section class="relative h-screen">
	{#if loadingState}
		<Loader />
	{/if}

	<nav class="sticky top-0 z-10 flex h-16 items-center justify-between bg-black px-5 py-1">
		<!-- Logo -->
		<a href="/"><img alt="Snap Sort logo" src="/logo.svg" class="w-20" /></a>
	</nav>

	<div class="flex place-content-center">
		<div class="mx-2 mt-14 w-full max-w-lg bg-white text-black">
			<form
				method="POST"
				action="?/changePassword"
				use:enhance={() => {
					loadingState = true;
					return async ({ update }) => {
						await update();
						loadingState = false;
					};
				}}
				class="mx-4 grid grid-cols-3 items-center gap-4 py-4"
			>
				<label for="oldPassword" class="col-span-1">Old Password:</label>
				<input type="password" name="oldPassword" id="oldPassword" class="col-span-2" />
				<label for="newPassword" class="col-span-1">New Password:</label>
				<input type="password" name="newPassword" id="newPassword" class="col-span-2" />
				<input
					type="submit"
					value="Update Password"
					class="col-span-3 bg-black py-2 text-xl text-white transition hover:bg-blue-600 active:bg-blue-800"
				/>
			</form>
		</div>
	</div>
</section>

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

<!-- Form result -->
{#if showSuccessModal}
	<section class="fixed inset-0 z-50 flex flex-col">
		<button
			aria-label="close-errors-modal"
			class="grow bg-black/70"
			onclick={() => (showSuccessModal = false)}
		></button>
		<div class="bg-green-200 px-4 py-2 text-green-950">
			<div class="mb-2 flex justify-between">
				<span class="text-xl font-bold">Alert:</span>
				<button onclick={() => (showSuccessModal = false)} class="cursor-pointer text-xl font-bold">
					<IconClose />
				</button>
			</div>
			<hr />
			<ul class="mt-2 px-2">
				{#each form?.messages?.filter(removeDuplicatesPredicate) ?? [] as error, i (i)}
					<li class="my-2">{error}</li>
				{/each}
			</ul>
		</div>
	</section>
{/if}
