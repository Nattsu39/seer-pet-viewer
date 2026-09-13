import { disposeSwfClipData } from "@seer-pet-anim/swf-bundle";
import { closeSpineClipData } from "@seer-pet-anim/spine-bundle";
import type { PetClip } from "../composables/usePetLoader";

export function disposePetClip(pet: PetClip): void {
  if (pet.type === "swf") {
    disposeSwfClipData(pet.clip);
  } else {
    closeSpineClipData(pet.clip);
  }
}
