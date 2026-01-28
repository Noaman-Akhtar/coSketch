import express from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./config";
import { middleware } from "./middleware";
import bcrypt from "bcrypt";
import { prismaClient } from "@repo/db";
import { CreateUserSchema, SigninSchema, CreateRoomSchema } from "@repo/common/types";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

app.post("/signup", async (req, res) => {
    try {
        const parsedData = CreateUserSchema.safeParse(req.body);

        if (!parsedData.success) {
            res.status(400).json({ error: "Invalid input", details: parsedData.error.issues });
            return;
        }

        const { email, password, name } = parsedData.data;

        // Check if user already exists
        const existingUser = await prismaClient.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            res.status(400).json({ error: "User already exists" });
            return;
        }
        const hashedPassword = await bcrypt.hash(password,10);
        // Create new user
        const user = await prismaClient.user.create({
            data: {
                email,
                password:hashedPassword, // Note: In production, hash the password!
                name
            }
        });

        const token = jwt.sign({ userId: user.id }, JWT_SECRET);

        res.json({
            message: "User created successfully",
            token,
            userId: user.id
        });
    } catch (error) {
        console.error("Signup error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/signin", async (req, res) => {
    try {
        const parsedData = SigninSchema.safeParse(req.body);

        if (!parsedData.success) {
            res.status(400).json({ error: "Invalid input", details: parsedData.error.issues });
            return;
        }

        const { email, password } = parsedData.data;

        const user = await prismaClient.user.findUnique({
            where: { email }
        });

        if (!user || user.password !== password) {
            res.status(401).json({ error: "Invalid credentials" });
            return;
        }
        const isPasswordValid = await bcrypt.compare(password,user.password);
            if(!isPasswordValid){
                res.status(401).json({
                    error:"Invalid credentials"
                })
                return ;
            }
        const token = jwt.sign({ userId: user.id }, JWT_SECRET);

        res.json({ token });
    } catch (error) {
        console.error("Signin error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
})

app.post("/room", middleware, async (req, res) => {
    const parsedData = CreateRoomSchema.safeParse(req.body);
    if (!parsedData.success) {
        res.json({
            message: "Incorrect inputs"
        })
        return;
    }
    const userId = req.userId as string;
    try {
        const room = await prismaClient.room.create({
            data: {
                slug: parsedData.data.name,
                adminId: userId
            }
        })
        res.json({
            roomId: room.id
        })
    } catch (e) {
        res.status(411).json({
            message: "Room already exists with this name"
        })
    }

})

app.listen(8000, () => {
    console.log("Server running on port 8000");
});