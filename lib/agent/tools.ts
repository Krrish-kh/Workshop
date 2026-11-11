import "server-only";
import { z } from "zod";
import { defineTool, type AgentTool } from "./defineTool";
import { getSupabase } from "../supabase";
import { CURRENT_STUDENT_ID, formatSlot } from "../campusbite";

const getMenu = defineTool({
  name: "getMenu",
  description: "Use this when the student asks about available canteen food, prices, or dietary options.",
  schema: z.object({
    category: z.enum(["meal", "snack", "drink", "sweet"]).optional()
      .describe("Only show this menu category, if requested."),
    veg_only: z.boolean().optional()
      .describe("Set to true to show only vegetarian items."),
    max_price: z.number().int().positive().optional()
      .describe("Maximum price in whole rupees, if the student gives a budget."),
  }),
  run: async ({ category, veg_only, max_price }) => {
    let query = getSupabase()
      .from("menu_items")
      .select("id, name, category, price, is_veg, stock, description")
      .gt("stock", 0)
      .order("category")
      .order("price");
    if (category) query = query.eq("category", category);
    if (veg_only) query = query.eq("is_veg", true);
    if (max_price !== undefined) query = query.lte("price", max_price);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { count: data.length, items: data };
  },
});

const getWalletBalance = defineTool({
  name: "getWalletBalance",
  description: "Use this when the student asks about their wallet or before checking what they can afford.",
  schema: z.object({}),
  run: async () => {
    const { data, error } = await getSupabase()
      .from("wallets")
      .select("name, balance")
      .eq("student_id", CURRENT_STUDENT_ID)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Wallet not found for the current student.");
    return data;
  },
});

const getPickupSlots = defineTool({
  name: "getPickupSlots",
  description: "Use this when the student asks about pickup times or before choosing a pickup time for an order.",
  schema: z.object({}),
  run: async () => {
    const { data, error } = await getSupabase()
      .from("pickup_slots")
      .select("id, slot_time, capacity, booked")
      .order("slot_time");
    if (error) throw new Error(error.message);
    return {
      slots: data
        .map((slot) => ({
          slot_id: slot.id,
          time: formatSlot(slot.slot_time),
          free: slot.capacity - slot.booked,
        }))
        .filter((slot) => slot.free > 0),
    };
  },
});

const getMyOrders = defineTool({
  name: "getMyOrders",
  description: "Use this when the student asks about their recent orders or their order status.",
  schema: z.object({}),
  run: async () => {
    const { data, error } = await getSupabase()
      .from("orders")
      .select("id, status, total, created_at, pickup_slots(slot_time), order_items(menu_items(name))")
      .eq("student_id", CURRENT_STUDENT_ID)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);

    return {
      orders: data.map((order) => {
        const slot = Array.isArray(order.pickup_slots)
          ? order.pickup_slots[0]
          : order.pickup_slots;
        const items = order.order_items.flatMap((item) => {
          const menuItem = Array.isArray(item.menu_items)
            ? item.menu_items[0]
            : item.menu_items;
          return menuItem ? [menuItem.name] : [];
        });
        return {
          id: order.id,
          status: order.status,
          total: order.total,
          pickup_time: slot ? formatSlot(slot.slot_time) : null,
          items,
        };
      }),
    };
  },
});

const placeOrder = defineTool({
  name: "placeOrder",
  description: "Use this when the student confirms the items and pickup slot for a canteen order.",
  writes: true,
  schema: z.object({
    items: z.array(
      z.object({
        menu_item_id: z.number().int().positive().describe("The menu item id."),
        quantity: z.number().int().min(1).max(5).describe("Quantity to order, from 1 to 5."),
      })
    ).min(1).describe("At least one menu item and its quantity."),
    slot_id: z.number().int().positive().describe("The id of the selected pickup slot."),
  }),
  run: async ({ items, slot_id }) => {
    const { data, error } = await getSupabase().rpc("place_order", {
      p_student_id: CURRENT_STUDENT_ID,
      p_slot_id: slot_id,
      p_items: items,
    });
    if (error) throw new Error(error.message);
    return data;
  },
});

const cancelOrder = defineTool({
  name: "cancelOrder",
  description: "Use this when the student asks to cancel one of their orders.",
  writes: true,
  schema: z.object({
    order_id: z.number().int().positive().describe("The id of the student's order."),
  }),
  run: async ({ order_id }) => {
    const { data, error } = await getSupabase().rpc("cancel_order", {
      p_student_id: CURRENT_STUDENT_ID,
      p_order_id: order_id,
    });
    if (error) throw new Error(error.message);
    return data;
  },
});

export const tools: AgentTool[] = [
  getMenu,
  getWalletBalance,
  getPickupSlots,
  getMyOrders,
  placeOrder,
  cancelOrder,
];
