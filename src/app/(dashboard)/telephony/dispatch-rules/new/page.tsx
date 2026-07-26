import { redirect } from "next/navigation";

/**
 * Rule creation is a dialog on the list page now, with its open state in the
 * URL. Kept so existing links still land somewhere useful.
 */
export default function NewDispatchRuleRedirect() {
  redirect("/telephony/dispatch-rules?rule=new");
}
