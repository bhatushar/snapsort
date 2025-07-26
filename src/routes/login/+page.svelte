<script lang="ts">
	import type { PageProps } from './$types';
	import IconClose from '~icons/material-symbols/close';
	import { removeDuplicatesPredicate } from '$lib/utility';
	import { enhance } from '$app/forms';
	import Loader from '$lib/components/loader.svelte';

	let { data, form }: PageProps = $props();
	let showErrorsModal = $derived<boolean>((form?.errors?.length ?? 0) !== 0);
	let loadingState = $state(false);
</script>

<svelte:head>
	<title>SnapSort - Login</title>
</svelte:head>

<section class="relative h-screen">
	{#if loadingState}
		<Loader />
	{/if}

	<nav class="sticky top-0 z-10 flex h-16 items-center justify-between bg-black px-5 py-1">
		<!-- Logo -->
		<a href="/login"><img alt="Snap Sort logo" src="/logo.svg" class="w-20" /></a>
	</nav>

	<div class="flex place-content-center">
		<div class="mx-2 mt-14 w-full max-w-lg bg-white text-black">
			{#if data.passwordRegistered}
				<!-- Login form -->
				<form
					method="POST"
					action="?/login"
					use:enhance={() => {
						loadingState = true;
						return async ({ update }) => {
							await update();
							loadingState = false;
						};
					}}
					class="mx-4 grid grid-cols-3 items-center gap-4 py-4"
				>
					<label for="password" class="col-span-1">Password:</label>
					<input type="password" name="password" id="password" class="col-span-2" />
					<input
						type="submit"
						value="Login"
						class="col-span-3 bg-black py-2 text-xl text-white transition hover:bg-blue-600 active:bg-blue-800"
					/>
				</form>
			{:else}
				<!-- Registration form -->
				<form
					method="POST"
					action="?/registerPassword"
					use:enhance={() => {
						loadingState = true;
						return async ({ update }) => {
							await update();
							loadingState = false;
						};
					}}
					class="mx-4 grid grid-cols-3 items-center gap-4 py-4"
				>
					<label for="password" class="col-span-1">Password:</label>
					<input type="password" name="password" id="password" class="col-span-2" />
					<input
						type="submit"
						value="Register"
						class="col-span-3 bg-black py-2 text-xl text-white transition hover:bg-blue-600 active:bg-blue-800"
					/>
				</form>
			{/if}
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
