import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "@repo/backend-common/config";
import { prismaClient } from "@repo/db";
import { z } from "zod";

// =============================================================================
// STEP 1: UNDERSTANDING THE DATA STRUCTURES
// =============================================================================

/**
 * We need to track:
 * 1. Which users are in which room
 * 2. Each user's WebSocket connection
 * 3. User metadata (id, name, etc.)
 * 
 * Think of it like a chat room:
 * - Room "abc123" has users [Alice, Bob, Charlie]
 * - Each user has a WebSocket connection we can send messages to
 */

// Store user info along with their WebSocket connection
interface User {
    ws: WebSocket;
    userId: string;
    roomId: string;
    dbRoomId: number;
}

type TrackedWebSocket = WebSocket & { isAlive: boolean };

const JoinRoomMessageSchema = z.object({
    type: z.literal("join_room"),
    roomId: z.string().min(1),
    token: z.string().min(1)
});

const CursorMessageSchema = z.object({
    type: z.literal("cursor"),
    x: z.number().finite(),
    y: z.number().finite()
});

const DrawMessageSchema = z.object({
    type: z.literal("draw"),
    shape: z.record(z.string(), z.unknown())
});

const IncomingMessageSchema = z.discriminatedUnion("type", [
    JoinRoomMessageSchema,
    CursorMessageSchema,
    DrawMessageSchema
]);

// Room ID -> Array of users in that room
// Example: { "room-abc": [User1, User2], "room-xyz": [User3] }
const rooms = new Map<string, User[]>();

// =============================================================================
// STEP 2: CREATE THE WEBSOCKET SERVER
// =============================================================================

const wss = new WebSocketServer({ port: 8081 });
console.log("WebSocket server running on port 8081");

const HEARTBEAT_INTERVAL_MS = 30000;

const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((client) => {
        const socket = client as TrackedWebSocket;
        if (socket.isAlive === false) {
            socket.terminate();
            return;
        }
        socket.isAlive = false;
        socket.ping();
    });
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => {
    clearInterval(heartbeatInterval);
});

// =============================================================================
// STEP 3: HANDLE NEW CONNECTIONS
// =============================================================================

wss.on("connection", (ws: WebSocket) => {
    /**
     * When a user connects, we don't know who they are yet.
     * They need to send a "join_room" message with their token.
     * 
     * Flow:
     * 1. User connects (we're here)
     * 2. User sends: { type: "join_room", roomId: "abc", token: "jwt..." }
     * 3. We verify token, add them to room
     * 4. Now they can send/receive drawing events
     */

    let currentUser: User | null = null;
    const trackedWs = ws as TrackedWebSocket;
    trackedWs.isAlive = true;

    trackedWs.on("pong", () => {
        trackedWs.isAlive = true;
    });

    ws.on("message", async (data) => {
        try {
            // Parse + validate incoming message
            const jsonData = JSON.parse(data.toString());
            const parsedMessage = IncomingMessageSchema.safeParse(jsonData);

            if (!parsedMessage.success) {
                ws.send(JSON.stringify({
                    type: "error",
                    message: "Invalid message payload"
                })); 
                return;
            }

            const message = parsedMessage.data;

            // ===========================================================
            // MESSAGE TYPE: join_room
            // ===========================================================
            if (message.type === "join_room") {
                /**
                 * User wants to join a room.
                 * 
                 * Why do we need a token?
                 * - WebSocket doesn't have cookies/headers like HTTP
                 * - We pass the JWT token in the message
                  * - This proves the user is authenticated
                 */

                const { roomId, token } = message;

                if (currentUser && currentUser.roomId === roomId) {
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Already joined this room"
                    }));
                    return;
                }

                if (currentUser) {
                    removeUserFromRoom(currentUser, ws);
                    currentUser = null;
                }

                // Verify the JWT token
                let userId: string;
                try {
                    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
                    userId = decoded.userId;
                } catch (e) {
                    ws.send(JSON.stringify({ type: "error", message: "Invalid token" }));
                    ws.close();
                    return;
                }

                // Check if room exists in database
                const room = await prismaClient.room.findUnique({
                    where: { slug: roomId }
                });

                if (!room) {
                    ws.send(JSON.stringify({ type: "error", message: "Room not found" }));
                    return;
                }

                // Create user object
                currentUser = { ws, userId, roomId, dbRoomId: room.id };

                // Add user to room (create room array if doesn't exist)
                if (!rooms.has(roomId)) {
                    rooms.set(roomId, []);
                }
                rooms.get(roomId)!.push(currentUser);

                console.log(`User ${userId} joined room ${roomId}`);

                // Fetch existing shapes/chats from database to send to new user
                const existingChats = await prismaClient.chat.findMany({
                    where: { roomId: currentUser.dbRoomId },
                    orderBy: { id: "asc" }
                });

                // Send confirmation with existing shapes
                ws.send(JSON.stringify({
                    type: "room_joined",
                    shapes: existingChats.map(chat => JSON.parse(chat.message))
                }));

                // Notify other users in the room
                broadcastToRoom(roomId, {
                    type: "user_joined",
                    userId
                }, ws); // exclude the user who just joined
            }

            // ===========================================================
            // MESSAGE TYPE: draw (new shape created)
            // ===========================================================
            else if (message.type === "draw") {
                /**
                 * User drew a new shape. We need to:
                 * 1. Save it to database (persistence)
                 * 2. Broadcast to all other users in room (real-time)
                 */

                if (!currentUser) {
                    ws.send(JSON.stringify({ type: "error", message: "Join a room first" }));
                    return;
                }

                const { shape } = message;

                // Save shape to database as a "chat" message
                await prismaClient.chat.create({
                    data: {
                        roomId: currentUser.dbRoomId,
                        userId: currentUser.userId,
                        message: JSON.stringify(shape)
                    }
                });

                // Broadcast to all users in room (including sender for confirmation)
                broadcastToRoom(currentUser.roomId, {
                    type: "draw",
                    shape,
                    userId: currentUser.userId
                });
            }

            // ===========================================================
            // MESSAGE TYPE: cursor (mouse position for collaboration)
            // ===========================================================
            else if (message.type === "cursor") {
                /**
                 * User moved their cursor. Broadcast to others so they
                 * can see where the user is pointing.
                 * 
                 * Note: We DON'T save this to database (too frequent, not needed)
                 */

                if (!currentUser) return;

                broadcastToRoom(currentUser.roomId, {
                    type: "cursor",
                    x: message.x,
                    y: message.y,
                    userId: currentUser.userId
                }, ws); // exclude sender (they know their own cursor position)
            }

        } catch (e) {
            console.error("Error processing message:", e);
        }
    });

    // ===========================================================
    // HANDLE DISCONNECTION
    // ===========================================================
    ws.on("close", () => {
        /**
         * User disconnected. We need to:
         * 1. Remove them from the room
         * 2. Notify other users
         */

        if (!currentUser) return;

        removeUserFromRoom(currentUser, ws);
        console.log(`User ${currentUser.userId} left room ${currentUser.roomId}`);
    });
});

// =============================================================================
// HELPER FUNCTION: BROADCAST TO ROOM
// =============================================================================

/**
 * Send a message to all users in a room.
 * 
 * @param roomId - The room to broadcast to
 * @param message - The message object to send
 * @param exclude - Optional: WebSocket to exclude (usually the sender)
 */
function broadcastToRoom(roomId: string, message: object, exclude?: WebSocket) {
    const roomUsers = rooms.get(roomId);
    if (!roomUsers) return;

    const messageStr = JSON.stringify(message);

    for (const user of roomUsers) {
        // Skip the excluded user (usually the sender)
        if (exclude && user.ws === exclude) continue;

        // Only send to open connections
        if (user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(messageStr);
        }
    }
}

function removeUserFromRoom(user: User, socket: WebSocket) {
    const roomUsers = rooms.get(user.roomId);
    if (!roomUsers) return;

    const index = roomUsers.findIndex((roomUser) => roomUser.ws === socket);
    if (index !== -1) {
        roomUsers.splice(index, 1);
    }

    if (roomUsers.length === 0) {
        rooms.delete(user.roomId);
        return;
    }

    broadcastToRoom(user.roomId, {
        type: "user_left",
        userId: user.userId
    });
}