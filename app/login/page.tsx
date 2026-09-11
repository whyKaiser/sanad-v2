import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/sanad/auth";
import LoginForm from "@/components/sanad/login-form";
export const dynamic="force-dynamic";
export default async function Login(){if(await getCurrentUser())redirect("/");return <LoginForm/>;}
