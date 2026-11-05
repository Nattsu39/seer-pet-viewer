<script setup lang="ts">
import { computed } from "vue";
import type { usePetLoader } from "../composables/usePetLoader";
import {
  canNamedRemoteBundleDownload,
  githubBundleRawDownloadUrl,
  newseerBundleDownloadUrl,
  remoteBundleDownloadFilename,
} from "../lib/remote-bundle";
import RemoteLoadNotice from "./RemoteLoadNotice.vue";

const props = defineProps<{ loader: ReturnType<typeof usePetLoader> }>();

const entry = computed(() => props.loader.remoteLoadContext.value?.entry);
const downloadBundle = computed(
  () => props.loader.remoteLoadContext.value?.failedBundle ?? entry.value,
);
const canNamedDownload = computed(
  () =>
    !props.loader.cdnFileTooLarge.value &&
    !!downloadBundle.value &&
    canNamedRemoteBundleDownload(downloadBundle.value),
);
const downloadFilename = computed(() =>
  downloadBundle.value
    ? remoteBundleDownloadFilename(downloadBundle.value)
    : null,
);
const githubDownloadUrl = computed(() =>
  props.loader.cdnFileTooLarge.value && downloadBundle.value
    ? githubBundleRawDownloadUrl(downloadBundle.value)
    : null,
);
const officialDownloadUrl = computed(() => {
  if (!downloadBundle.value) return null;
  try {
    return newseerBundleDownloadUrl(downloadBundle.value);
  } catch {
    return null;
  }
});
</script>

<template>
  <RemoteLoadNotice
    :loading="loader.loading.value"
    :loading-message="loader.loadingMessage.value"
    :download-progress="loader.downloadProgress.value"
    :error="loader.error.value"
    :entry="entry ?? null"
    :download-path="downloadBundle?.path"
    :can-retry="!!loader.remoteLoadContext.value"
    :can-named-download="canNamedDownload"
    :download-filename="downloadFilename"
    :official-download-url="officialDownloadUrl"
    :github-download-url="githubDownloadUrl"
    :downloading="loader.downloadingBundle.value"
    @retry="loader.retryRemoteLoad"
    @named-download="loader.downloadNamedRemoteBundle"
    @dismiss="loader.dismissError"
  />
</template>
