import express from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./config";  
import { middleware } from "./middleware";
import { prismaClient } from "@repo/db";
import { CreateUserSchema, SigninSchema } from "@repo/common/types";

const app = express();
app.use(express.json());

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

        // Create new user
        const user = await prismaClient.user.create({
            data: {
                email,
                password, // Note: In production, hash the password!
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

        const token = jwt.sign({ userId: user.id }, JWT_SECRET);

        res.json({ token });
    } catch (error) {
        console.error("Signin error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
})

app.post("/room", middleware, (req, res) => {

})

app.listen(8000, () => {
    console.log("Server running on port 8000");
});