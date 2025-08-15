<script lang="ts">
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import Loader from '$lib/components/loader.svelte';
	import NoticeModal from '$lib/components/notice-modal.svelte';

	let { data, form }: PageProps = $props();
	let showLoader = $state(false);
</script>

<svelte:head>
	<title>SnapSort - Login</title>
</svelte:head>

<section class="relative h-screen">
	<Loader {showLoader} />

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
						showLoader = true;
						return async ({ update }) => {
							await update();
							showLoader = false;
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
						showLoader = true;
						return async ({ update }) => {
							await update();
							showLoader = false;
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

<!-- Form result -->
<NoticeModal modalType="error" messages={form?.errors ?? []} />
