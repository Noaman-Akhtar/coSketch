import express from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./config";  
import { middleware } from "./middleware";    

const app = express();

app.post("/signup",(req, res)=>{

})

app.post("/signin",(req, res)=>{

    const userId =1;
    const token = jwt.sign({
        userId
    },JWT_SECRET);

    res.json({token})
})

app.post("/room",middleware,(req, res)=>{

})

app.listen(8000);