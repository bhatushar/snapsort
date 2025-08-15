<script lang="ts">
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import Loader from '$lib/components/loader.svelte';
	import NoticeModal from '$lib/components/notice-modal.svelte';

	let { form }: PageProps = $props();
	let showLoader = $state(false);
</script>

<svelte:head>
	<title>SnapSort - Change Password</title>
</svelte:head>

<section class="relative h-screen">
	<Loader {showLoader} />

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
					showLoader = true;
					return async ({ update }) => {
						await update();
						showLoader = false;
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

<!-- Form result -->
<NoticeModal modalType="error" messages={form?.errors ?? []} />
<NoticeModal modalType="success" messages={form?.messages ?? []} />
