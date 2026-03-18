import {z} from "zod";

// =============================================================================
// AUTH SCHEMAS (for HTTP API validation)
// =============================================================================

export const CreateUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6).max(100),
    name: z.string().min(3).max(20)
});

export const SigninSchema = z.object({
    email: z.string().email(),
    password: z.string()
}) 

export const CreateRoomSchema = z.object({
    name: z.string().min(3).max(20)
})

// =============================================================================
// SHAPE TYPES (for the drawing canvas)
// =============================================================================

/**
 * Every shape has these common properties:
 * - id: Unique identifier (for updating/deleting)
 * - x, y: Position on canvas
 * - strokeColor, fillColor: Colors
 */

export type ShapeType = "rect" | "ellipse" | "line" | "arrow" | "pencil" | "text";

export interface BaseShape {
    id: string;
    type: ShapeType;
    x: number;
    y: number;
    strokeColor: string;
    fillColor: string;
    strokeWidth: number;
}

export interface RectShape extends BaseShape {
    type: "rect";
    width: number;
    height: number;
}

export interface EllipseShape extends BaseShape {
    type: "ellipse";
    width: number;
    height: number;
}

export interface LineShape extends BaseShape {
    type: "line";
    endX: number;
    endY: number;
}

export interface ArrowShape extends BaseShape {
    type: "arrow";
    endX: number;
    endY: number;
}

export interface PencilShape extends BaseShape {
    type: "pencil";
    points: { x: number; y: number }[]; // Array of points for freehand drawing
}

export interface TextShape extends BaseShape {
    type: "text";
    text: string;
    fontSize: number;
}

export type Shape = RectShape | EllipseShape | LineShape | ArrowShape | PencilShape | TextShape;


// WEBSOCKET MESSAGE TYPES
//Messages sent from Client to Server
export type ClientMessage = 
    | { type: "join_room"; roomId: string; token: string }
    | { type: "draw"; shape: Shape }
    | { type: "update"; shapeId: string; shape: Partial<Shape> }
    | { type: "delete"; shapeId: string }
    | { type: "cursor"; x: number; y: number };

// Messages sent from Server to Client
export type ServerMessage =
    | { type: "room_joined"; shapes: Shape[] }
    | { type: "user_joined"; userId: string }
    | { type: "user_left"; userId: string }
    | { type: "draw"; shape: Shape; userId: string }
    | { type: "update"; shapeId: string; shape: Partial<Shape>; userId: string }
    | { type: "delete"; shapeId: string; userId: string }
    | { type: "cursor"; x: number; y: number; userId: string }
    | { type: "error"; message: string };