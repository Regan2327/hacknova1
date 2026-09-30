"""Optional CP-SAT assignment solver. Input/output are JSON over stdio."""
import json
import sys


def main():
    try:
        from ortools.sat.python import cp_model
    except ImportError:
        print(json.dumps({"error": "Google OR-Tools is not installed."}))
        return 2

    payload = json.load(sys.stdin)
    slots = payload.get("slots", [])
    model = cp_model.CpModel()
    variables = {}
    by_unit = {}
    for slot_index, slot in enumerate(slots):
        choices = []
        for option_index, option in enumerate(slot.get("options", [])):
            variable = model.NewBoolVar(f"x_{slot_index}_{option_index}")
            variables[(slot_index, option_index)] = variable
            choices.append(variable)
            by_unit.setdefault(option["unitId"], []).append(variable)
        if choices:
            model.Add(sum(choices) <= 1)
    for assignments in by_unit.values():
        model.Add(sum(assignments) <= 1)

    objective_terms = []
    for (slot_index, option_index), variable in variables.items():
        score = round(float(slots[slot_index]["options"][option_index]["score"]) * 100)
        objective_terms.append(score * variable)
    model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(payload.get("timeLimitSeconds", 8))
    solver.parameters.num_search_workers = 1
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print(json.dumps({"error": f"CP-SAT ended with status {solver.StatusName(status)}"}))
        return 3

    assignments = []
    for (slot_index, option_index), variable in variables.items():
        if solver.Value(variable):
            option = slots[slot_index]["options"][option_index]
            assignments.append({"slotIndex": slot_index, "unitId": option["unitId"]})
    print(json.dumps({
        "status": solver.StatusName(status),
        "optimal": status == cp_model.OPTIMAL,
        "objective": solver.ObjectiveValue(),
        "bestBound": solver.BestObjectiveBound(),
        "assignments": assignments,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
