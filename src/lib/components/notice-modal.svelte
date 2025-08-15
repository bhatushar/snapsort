<script lang="ts">
	import { removeDuplicatesPredicate } from '$lib/utility';
	import IconClose from '~icons/material-symbols/close';

	type ModalProps = {
		modalType: 'error' | 'success';
		messages: string[];
	};

	let { modalType, messages }: ModalProps = $props();

	let showModal = $derived<boolean>(messages.length > 0);

	const modalColorsByType = {
		error: 'bg-red-200 text-red-950',
		success: 'bg-green-200 text-green-950'
	};
</script>

{#if showModal}
	<section class="fixed inset-0 z-50 flex flex-col">
		<button
			aria-label="close-errors-modal"
			class="grow bg-black/70"
			onclick={() => (showModal = false)}
		></button>
		<div class={`px-4 py-2 ${modalColorsByType[modalType]}`}>
			<div class="mb-2 flex justify-between">
				<span class="text-xl font-bold">
					{modalType === 'error' ? 'Something went wrong:' : 'Server says:'}
				</span>
				<button onclick={() => (showModal = false)} class="cursor-pointer text-xl font-bold">
					<IconClose />
				</button>
			</div>
			<hr />
			<ul class="mt-2 px-2">
				{#each messages.filter(removeDuplicatesPredicate) ?? [] as message, i (i)}
					<li class="my-2">{message}</li>
				{/each}
			</ul>
		</div>
	</section>
{/if}
