import Tracker from "@/components/Tracker";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { u, type } = await searchParams;
  return (
    <Tracker
      initialUser={typeof u === "string" ? u : ""}
      initialKind={type === "comments" ? "comments" : "posts"}
    />
  );
}
