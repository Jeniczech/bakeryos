import {
    getCommittedQuantity,
    getRemainingAvailability,
    type PlanQuantities,
} from './availability';

export type DailyProductionItem = {
    productId: string;
    productName: string;
    capacity: number;
    activeReserved: number;
    retainedCancelled: number;
    walkInQuantity: number;
    recommendedProduction: number;
    remainingAvailability: number;
};

export const getRecommendedProduction = (plan: PlanQuantities): number =>
    getCommittedQuantity(plan) + plan.walkInQuantity;

export const buildDailyProductionItem = (
    product: { productId: string; productName: string },
    plan: PlanQuantities,
): DailyProductionItem => ({
    productId: product.productId,
    productName: product.productName,
    capacity: plan.capacity,
    activeReserved: plan.activeReserved,
    retainedCancelled: plan.retainedCancelled,
    walkInQuantity: plan.walkInQuantity,
    recommendedProduction: getRecommendedProduction(plan),
    remainingAvailability: getRemainingAvailability(plan),
});
