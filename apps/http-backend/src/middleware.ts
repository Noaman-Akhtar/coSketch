import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./config";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function middleware(req:Request,res:Response,next:NextFunction){
    const token = req.headers["authorization"] ?? "";

    const decoded = jwt.verify(token, JWT_SECRET);

    if (typeof decoded === "object" && decoded !== null && "userId" in decoded) {
        req.userId = (decoded as jwt.JwtPayload).userId as string;
        next();
    } else {
        res.status(403).json({
            message: "unauthorized"
        });
    }
}