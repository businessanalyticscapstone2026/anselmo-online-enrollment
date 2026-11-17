const STEPS = [
  "Track Selection",
  "Cluster Selection",
  "Student Info",
  "Requirements",
  "Account",
] as const;

export default function EnrollmentProgress({
  activeStep,
}: {
  activeStep: number;
}) {
  return (
    <div className="border-b border-emerald-800/60 bg-[#0b3d2e]/60 backdrop-blur-md">
      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
        <div className="flex items-center">
          {STEPS.map((label, index) => {
            const stepNumber = index + 1;
            const isCompleted = stepNumber < activeStep;
            const isActive = stepNumber === activeStep;

            return (
              <div key={label} className="flex flex-1 items-center last:flex-none">
                <div className="flex items-center">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold sm:h-9 sm:w-9 sm:text-sm ${
                      isCompleted || isActive
                        ? "bg-linear-to-br from-yellow-300 via-yellow-400 to-yellow-500 text-[#052e1c] shadow-[0_0_15px_rgba(250,204,21,0.45)]"
                        : "border border-emerald-700 bg-emerald-900/40 text-emerald-200"
                    }`}
                  >
                    {isCompleted ? "✓" : stepNumber}
                  </div>

                  <span
                    className={`ml-2 hidden text-xs font-semibold sm:block sm:text-sm ${
                      isCompleted || isActive
                        ? "text-yellow-200"
                        : "text-emerald-200"
                    }`}
                  >
                    {label}
                  </span>
                </div>

                {index < STEPS.length - 1 && (
                  <div
                    className={`mx-2 h-px flex-1 sm:mx-4 ${
                      isCompleted ? "bg-yellow-400" : "bg-emerald-800"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
