<script lang="ts">
</script>

<svelte:head>
	<title>SnapSort - Settings</title>
</svelte:head>

<section class="relative h-screen">
	<nav class="sticky top-0 z-10 flex h-16 items-center justify-between bg-black px-5 py-1">
		<!-- Logo -->
		<a href="/"><img alt="Snap Sort logo" src="/logo.svg" class="w-20" /></a>
	</nav>

	<!-- Menu -->
	<div
		class="mx-auto mt-4 flex w-4/5 max-w-lg flex-col bg-white px-1 py-1 text-left text-lg font-semibold text-black"
	>
		<a
			href="/settings/manage-keywords"
			class="w-full cursor-pointer px-3 py-2 transition hover:bg-blue-600 hover:text-white active:bg-blue-800 active:text-white"
		>
			Manage Keywords
		</a>
		<hr />

		<a
			href="/settings/view-library"
			class="w-full cursor-pointer px-3 py-2 transition hover:bg-blue-600 hover:text-white active:bg-blue-800 active:text-white"
		>
			View Library
		</a>
		<hr />

		<a
			href="/api/export-exif"
			download="metadata.json"
			class="w-full cursor-pointer px-3 py-2 transition hover:bg-blue-600 hover:text-white active:bg-blue-800 active:text-white"
		>
			Export EXIF Data
		</a>
		<hr />

		<a
			href="/settings/change-password"
			class="w-full cursor-pointer px-3 py-2 transition hover:bg-blue-600 hover:text-white active:bg-blue-800 active:text-white"
		>
			Change Password
		</a>
		<hr />

		<form method="POST" action="?/logout">
			<input
				type="submit"
				value="Logout"
				class="w-full cursor-pointer px-3 py-2 text-left transition hover:bg-blue-600 hover:text-white active:bg-blue-800 active:text-white"
			/>
		</form>
	</div>
</section>
