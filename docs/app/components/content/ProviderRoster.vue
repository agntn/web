<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { PROVIDERS, type ProviderInfo } from "../../utils/providers";
import { ROSTER_CLASS, ROSTER_TABLE_UI } from "../../utils/roster";

/** Empty until a header is clicked: the rows then keep the catalog order. */
const sorting = ref<{ id: string; desc: boolean }[]>([]);

const roster = useTemplateRef<HTMLElement>("roster");
useRosterFlip(
  () => roster.value,
  () => sorting.value,
);

/** What a provider does, in the order the capabilities are always named. */
function capabilities(row: ProviderInfo): string {
  return [row.search ? "search" : "", row.searchImage ? "image" : "", row.read ? "read" : ""]
    .filter(Boolean)
    .join(" · ");
}

const rows = PROVIDERS.map((provider) => ({ ...provider, can: capabilities(provider), envKey: provider.envVar ?? "none" }));
type Row = (typeof rows)[number];

const columns: TableColumn<Row>[] = [
  {
    accessorKey: "label",
    header: "Provider",
    sortingFn: "text",
    meta: { class: { th: "w-[10.5rem]" } },
  },
  /* Narrow, the row reads name and capabilities first, then the key, then the sentence. */
  {
    accessorKey: "envKey",
    header: "Key",
    enableSorting: false,
    meta: { class: { th: "w-[13rem]", td: "@max-[52rem]/roster:order-2" } },
  },
  {
    accessorKey: "about",
    header: "What it talks to",
    enableSorting: false,
    meta: { class: { td: "@max-[52rem]/roster:order-3" } },
  },
  {
    accessorKey: "can",
    header: "Can",
    sortingFn: "text",
    meta: {
      class: {
        th: "w-[10rem]",
        td: "@max-[52rem]/roster:order-1 @max-[52rem]/roster:col-span-1! @max-[52rem]/roster:justify-self-end",
      },
    },
  },
];

const order = computed(() => {
  const [first] = sorting.value;
  if (first === undefined) return "catalog order";
  const label = columns.find((column) => "accessorKey" in column && column.accessorKey === first.id)?.header;
  return `by ${String(label).toLowerCase()} ${first.desc ? "descending" : "ascending"}`;
});
</script>

<template>
  <section ref="roster" class="roster not-prose my-6" aria-label="Providers">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>
    <header :class="ROSTER_CLASS.bar">
      <span :class="ROSTER_CLASS.title">listProviders()</span>
      <span :class="ROSTER_CLASS.meta">{{ PROVIDERS.length }} providers · {{ order }}</span>
    </header>
    <div class="roster-ruler" aria-hidden="true" />
    <UTable
      v-model:sorting="sorting"
      :data="rows"
      :columns="columns"
      :get-row-id="(row) => row.key"
      :ui="ROSTER_TABLE_UI"
    >
      <template #label-header="{ column }"><RosterSort :column="column" label="Provider" /></template>
      <template #can-header="{ column }"><RosterSort :column="column" label="Can" /></template>
      <template #label-cell="{ row }">
        <NuxtLink :to="row.original.to" :class="[ROSTER_CLASS.name, 'items-baseline']">
          <UIcon :name="row.original.icon" class="relative top-0.5 size-3.5 flex-none" aria-hidden="true" />
          <span>{{ row.original.label }}</span>
        </NuxtLink>
      </template>
      <template #envKey-cell="{ row }">
        <span :class="row.original.envVar ? 'text-muted' : 'text-dimmed'" class="[overflow-wrap:anywhere]">{{
          row.original.envVar ?? "none, self-hosted"
        }}</span>
      </template>
      <template #about-cell="{ row }">
        <span :class="ROSTER_CLASS.about">{{ row.original.about }}</span>
      </template>
      <template #can-cell="{ row }">
        <span :class="ROSTER_CLASS.count"
          ><span :class="ROSTER_CLASS.leader" aria-hidden="true" /><span
            class="whitespace-nowrap text-highlighted"
            >{{ row.original.can }}</span
          ></span
        >
      </template>
    </UTable>
    <footer :class="ROSTER_CLASS.footer">
      <span>read from the catalog / no network</span>
      <span :class="ROSTER_CLASS.meta">create("&lt;key&gt;") loads one</span>
    </footer>
  </section>
</template>
