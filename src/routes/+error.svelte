<script lang="ts">
	import { page } from '$app/state';
	import IconAlertOutline from '~icons/mdi/alert-outline';
</script>

<section class="h-screen w-screen">
	<div class="flex h-full w-full flex-col items-center justify-center text-gray-500">
		<h1 class="flex items-center text-7xl font-bold text-red-900 opacity-70">
			<IconAlertOutline class="h-20 w-20" />
			{page.status}
		</h1>
		<h2 class="text-3xl font-semibold">{page.error?.message}</h2>
		<a
			href="/"
			class="flex cursor-pointer items-center transition hover:text-blue-600 active:text-blue-800"
		>
			Go back to home >
		</a>
	</div>
</section>
