import { disposeSwfClipData } from "@seer/swf-bundle";
import { closeSpineClipData } from "@seer/spine-bundle";
import type { PetClip } from "../composables/usePetLoader";

export function disposePetClip(pet: PetClip): void {
  if (pet.type === "swf") {
    disposeSwfClipData(pet.clip);
  } else {
    closeSpineClipData(pet.clip);
  }
}
