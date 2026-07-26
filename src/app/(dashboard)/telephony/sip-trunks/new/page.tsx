import { redirect } from "next/navigation";

/**
 * Trunk creation is a dialog on the list page now, with its open state in the
 * URL. This route is kept so existing links and bookmarks still land somewhere
 * useful.
 */
export default function NewTrunkRedirect() {
  redirect("/telephony/sip-trunks?trunk=new");
}
