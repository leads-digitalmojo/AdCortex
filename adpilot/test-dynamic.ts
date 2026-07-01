import { scoreStagedCostDynamic, scoreStagedBudgetDynamic } from './server/scoring-config';

console.log("CPSV (15682 / 23000):", scoreStagedCostDynamic(15682, 23000));
console.log("Budget (94093 / 86667):", scoreStagedBudgetDynamic(94093 / 86667 * 100)); // ~108%
console.log("CPL (729 / 700):", scoreStagedCostDynamic(729, 700));
console.log("CPQL (4481 / 2950):", scoreStagedCostDynamic(4481, 2950));
