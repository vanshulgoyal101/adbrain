import { ownerErrorIn, type OwnerErrorKey } from "@/i18n/locale";
import { CampaignEditError } from "./edit-service";

/**
 * #2314: an edit refusal the owner reads. Its message is the English `errors` text unless a stable
 * ledger text is given (stored edit rows must not change when the copy does), and the route answers
 * `ownerError(ownerKey)` in the owner's language.
 */
export class OwnerEditError extends CampaignEditError {
  constructor(readonly ownerKey: OwnerErrorKey, status: number, retryable = false, ledger = ownerErrorIn("en", ownerKey)) {
    super(ledger, status, retryable);
  }
}

export function ownerEditError(key: OwnerErrorKey, status: number, retryable = false, ledger?: string): OwnerEditError {
  return new OwnerEditError(key, status, retryable, ledger);
}

/** The words to send back for an edit refusal: the owner's language when it has a key. */
export async function editErrorWords(error: CampaignEditError, ownerError: (key: OwnerErrorKey) => Promise<string>): Promise<string> {
  return error instanceof OwnerEditError ? ownerError(error.ownerKey) : error.message;
}
