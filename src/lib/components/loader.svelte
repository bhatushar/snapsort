<script lang="ts">
	type LoaderProps = {
		showLoader: boolean;
	};
	let { showLoader }: LoaderProps = $props();
</script>

{#if showLoader}
	<section class="fixed z-50 flex h-screen w-screen items-center justify-center bg-black/90">
		<img src="/loader.svg" alt="Loading" />
	</section>
{/if}
