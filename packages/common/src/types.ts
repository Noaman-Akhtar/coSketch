import {z} from "zod";

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
    name:z.string().min(3).max(20)
})