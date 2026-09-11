import { getCurrentUser } from "@/lib/sanad/auth";
import { redirect } from "next/navigation";
import Workspace from "@/components/sanad/workspace";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getCurrentUser();
  if(!user)redirect("/login");
  return <Workspace displayName={user.displayName} />;
}
