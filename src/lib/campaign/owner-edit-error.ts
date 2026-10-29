import { ownerErrorIn, type OwnerErrorKey } from "@/i18n/locale";
import { CampaignEditError } from "./edit-service";

/**
 * #2314: an edit refusal the owner reads. Its message stays the English `errors` text (logs and
 * stored edit rows), and the route answers `ownerError(ownerKey)` in the owner's language.
 */
export class OwnerEditError extends CampaignEditError {
  constructor(readonly ownerKey: OwnerErrorKey, status: number, retryable = false) {
    super(ownerErrorIn("en", ownerKey), status, retryable);
  }
}

export function ownerEditError(key: OwnerErrorKey, status: number, retryable = false): OwnerEditError {
  return new OwnerEditError(key, status, retryable);
}

/** The words to send back for an edit refusal: the owner's language when it has a key. */
export async function editErrorWords(error: CampaignEditError, ownerError: (key: OwnerErrorKey) => Promise<string>): Promise<string> {
  return error instanceof OwnerEditError ? ownerError(error.ownerKey) : error.message;
}
