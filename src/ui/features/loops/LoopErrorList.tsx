export const LoopErrorList = ({ errors }: { errors: string[] }) =>
  errors.length > 0 && (
    <ul role="alert" className="mt-2 list-disc pl-5 text-sm text-red-700">
      {errors.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
