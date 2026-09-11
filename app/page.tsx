import { requireChatGPTUser } from "./chatgpt-auth";
import Workspace from "@/components/sanad/workspace";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <Workspace displayName={user.fullName || "مراجع سَنَد"} />;
}
