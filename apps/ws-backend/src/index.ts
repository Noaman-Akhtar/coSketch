import { WebSocket,WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "@repo/backend-common/config";
import {prismaClient} from "@repo/db";
import {z} from "zod";


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

interface User{
    ws: WebSocket;
    userId:string;
    roomId:string;
    dbRoomId:number;
}

type TrackedWebSocket = WebSocket & {isAlive:boolean};

const JoinRoomSchema = z.object({
    token: z.string(),
    roomId: z.string().min(1),
    type: z.literal("join_room")
})

const CursorMessageSchema = z.object({
    type: z.literal("cursor"),
    x: z.number(),
    y: z.number()
})

const DrawMessageSchema = z.object({
    type: z.literal("draw"),
    shape: z.record(z.string(), z.unknown())
});

const IncomingMessageSchema = z.discriminatedUnion("type", [
    JoinRoomSchema,
    CursorMessageSchema,
    DrawMessageSchema
]);

// Room ID -> Array of users in that room
// Example: { "room-abc": [User1, User2], "room-xyz": [User3] }
const rooms = new Map<string,User[]>();

//websocket server 
const wss = new WebSocketServer({ port:8081});
console.log("WebSocket server started on port 8081");

const HEARTBEAT_INTERVAL = 30000; 

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
}, HEARTBEAT_INTERVAL);

wss.on("close", () => {
    clearInterval(heartbeatInterval);
});

wss.on("connection",(ws:WebSocket)=>{
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

    let currentUser:User | null = null;
    const trackedWs = ws as TrackedWebSocket;
    trackedWs.isAlive = true ;

    trackedWs.on("pong",()=>{
        trackedWs.isAlive = true;
    });

    ws.on("message", async (data)=>{
        try{
            const jsonData = JSON.parse(data.toString());
            const parsedMessage = IncomingMessageSchema.safeParse(jsonData);

            if(!parsedMessage.success){
                ws.send(JSON.stringify({type:"error",
                message:"Invalid message format",
                }));
                return ;
            }

            const message = parsedMessage.data;
            if(message.type === "join_room"){
                /**
                 * User wants to join a room.
                 * 
                 * Why do we need a token?
                 * - WebSocket doesn't have cookies/headers like HTTP
                 * - We pass the JWT token in the message
                 * - This proves the user is authenticated
                 */
                const {roomId, token} = message;
                if(currentUser !== null && currentUser.roomId === roomId){
                    ws.send(JSON.stringify({
                        type:"error",
                        message:"Already in this room"
                    }));
                    return;
                }
                if(currentUser){
                        removeUserFromRoom(currentUser,ws);
                        currentUser = null;
                }

                let userId:string;
                try{
                    const decoded = jwt.verify(token,JWT_SECRET) as {userId:string};
                    userId = decoded.userId;

                }catch(error){
                    ws.send(JSON.stringify({
                        type:"error",
                        message:"Invalid token"
                    }));
                    ws.close();
                    return;
            }

               const room = await prismaClient.room.findUnique({
                where:{slug:roomId}
               })
               if(!room){
                ws.send(JSON.stringify({
                    type:"error",
                    message:"Room not found"}));
                    return;
               }

               currentUser = {ws, userId,roomId,dbRoomId:room.id};
               if(!rooms.has(roomId)){
                rooms.set(roomId,[]);
               }

               rooms.get(roomId)!.push(currentUser);
               console.log(`User ${userId} joined room ${roomId}`);

               const existingChats = await prismaClient.chat.findMany({
                where:{roomId:currentUser.dbRoomId},
                orderBy:{id:"asc"}
               });

               ws.send(JSON.stringify({
                type:"room_joined",
                shapes: existingChats.map(chat=> JSON.parse(chat.message))
               }));

               broadcastToRoom(roomId,{
                type:"user_joined",
                userId
               },ws);
            }
        }
    })
})