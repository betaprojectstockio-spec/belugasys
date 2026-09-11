from dataclasses import dataclass, field
from typing import Any


@dataclass
class PlanStep:
    command: str
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class ExecutionPlan:
    goal: str
    steps: list[PlanStep] = field(default_factory=list)


class Planner:
    MAX_STEPS = 10

    def create_plan(
        self,
        goal: str,
        actions: list[dict[str, Any]],
    ) -> ExecutionPlan:

        if not isinstance(goal, str) or not goal.strip():
            raise ValueError("Goal boş olamaz.")

        if not isinstance(actions, list):
            raise ValueError("Actions liste olmalıdır.")

        if len(actions) > self.MAX_STEPS:
            raise ValueError(
                f"Plan en fazla {self.MAX_STEPS} adım içerebilir."
            )

        steps = []

        for action in actions:
            if not isinstance(action, dict):
                raise ValueError("Geçersiz action formatı.")

            command = action.get("command")
            params = action.get("params", {})

            if not isinstance(command, str) or not command.strip():
                raise ValueError("Komut belirtilmemiş.")

            if not isinstance(params, dict):
                raise ValueError(
                    f"{command} için params sözlük olmalıdır."
                )

            steps.append(
                PlanStep(
                    command=command.strip(),
                    params=params,
                )
            )

        return ExecutionPlan(
            goal=goal.strip(),
            steps=steps,
        )

    @staticmethod
    def to_dict(plan: ExecutionPlan) -> dict[str, Any]:
        return {
            "goal": plan.goal,
            "steps": [
                {
                    "command": step.command,
                    "params": step.params,
                }
                for step in plan.steps
            ],
        }
