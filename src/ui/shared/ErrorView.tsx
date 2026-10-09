import { Button } from "@/shared/components/button";

export const ErrorView = ({ message, onRetry }: { message: string; onRetry: () => void }) => {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Cannot open project</h1>
      <p role="alert" className="mt-3 text-sm text-red-700">
        {message}
      </p>
      <Button className="mt-5" onClick={onRetry}>
        Retry
      </Button>
    </main>
  );
};
