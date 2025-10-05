import mongoose from "mongoose";
import { User } from "../models/user.model.js";
import { Payment } from "../models/payment.model.js";
import { Expense } from "../models/expense.model.js";
import { Flatmate } from "../models/flatmate.model.js";
import { connectDB } from "../db/index.js";

const seedData = async () => {
    try {
        // Connect to database
        await connectDB();

        // Clear existing data
        await User.deleteMany({});
        await Payment.deleteMany({});
        await Expense.deleteMany({});
        await Flatmate.deleteMany({});

        console.log("Cleared existing data");

        // Create sample users
        const users = await User.create([
            {
                userName: "john_doe",
                email: "john@example.com",
                password: "password123"
            },
            {
                userName: "alice_smith",
                email: "alice@example.com",
                password: "password123"
            },
            {
                userName: "bob_wilson",
                email: "bob@example.com",
                password: "password123"
            },
            {
                userName: "charlie_brown",
                email: "charlie@example.com",
                password: "password123"
            }
        ]);

        console.log("Created sample users");

        // Create flatmates
        const flatmates = await Flatmate.create([
            {
                userId: users[1]._id,
                name: "Alice Smith",
                email: "alice@example.com",
                role: "lead_tenant",
                monthlyContribution: 520,
                status: "active",
                contactNumber: "+1234567890"
            },
            {
                userId: users[2]._id,
                name: "Bob Wilson",
                email: "bob@example.com",
                role: "co_tenant",
                monthlyContribution: 480,
                status: "active",
                contactNumber: "+1234567891"
            },
            {
                userId: users[3]._id,
                name: "Charlie Brown",
                email: "charlie@example.com",
                role: "temporary_occupant",
                monthlyContribution: 0,
                status: "inactive",
                contactNumber: "+1234567892"
            }
        ]);

        console.log("Created sample flatmates");

        // Create sample payments for the first user
        const payments = await Payment.create([
            {
                userId: users[0]._id,
                title: "Monthly Rent",
                amount: 950,
                recipient: "Landlord",
                dueDate: new Date("2024-11-28"),
                type: "rent",
                priority: "high",
                status: "pending"
            },
            {
                userId: users[0]._id,
                title: "Electricity Bill",
                amount: 75.50,
                recipient: "Power Company",
                dueDate: new Date("2024-11-30"),
                type: "utility",
                priority: "medium",
                status: "pending"
            },
            {
                userId: users[0]._id,
                title: "Internet Service",
                amount: 50,
                recipient: "ISP Provider",
                dueDate: new Date("2024-12-05"),
                type: "utility",
                priority: "low",
                status: "pending"
            },
            {
                userId: users[0]._id,
                title: "Groceries Share",
                amount: 30,
                recipient: "Alice",
                dueDate: new Date("2024-11-25"),
                type: "flatmate",
                priority: "medium",
                status: "pending"
            },
            {
                userId: users[0]._id,
                title: "Water Bill",
                amount: 45.25,
                recipient: "Water Department",
                dueDate: new Date("2024-12-01"),
                type: "utility",
                priority: "low",
                status: "paid",
                paymentMethod: "card",
                paidAt: new Date()
            }
        ]);

        console.log("Created sample payments");

        // Create sample expenses
        const expenses = await Expense.create([
            {
                createdBy: users[0]._id,
                title: "Grocery Shopping",
                description: "Weekly grocery shopping for household",
                totalAmount: 120,
                category: "groceries",
                splitMethod: "equal",
                participants: [
                    {
                        userId: users[0]._id,
                        name: "John Doe",
                        amount: 40,
                        isPaid: true,
                        paidAt: new Date()
                    },
                    {
                        userId: users[1]._id,
                        name: "Alice Smith",
                        amount: 40,
                        isPaid: false
                    },
                    {
                        userId: users[2]._id,
                        name: "Bob Wilson",
                        amount: 40,
                        isPaid: false
                    }
                ],
                status: "active"
            },
            {
                createdBy: users[1]._id,
                title: "Internet Bill Split",
                description: "Monthly internet service bill",
                totalAmount: 60,
                category: "internet",
                splitMethod: "equal",
                participants: [
                    {
                        userId: users[0]._id,
                        name: "John Doe",
                        amount: 20,
                        isPaid: false
                    },
                    {
                        userId: users[1]._id,
                        name: "Alice Smith",
                        amount: 20,
                        isPaid: true,
                        paidAt: new Date()
                    },
                    {
                        userId: users[2]._id,
                        name: "Bob Wilson",
                        amount: 20,
                        isPaid: false
                    }
                ],
                status: "active"
            },
            {
                createdBy: users[0]._id,
                title: "Cleaning Supplies",
                description: "Monthly cleaning supplies purchase",
                totalAmount: 45,
                category: "cleaning",
                splitMethod: "equal",
                participants: [
                    {
                        userId: users[0]._id,
                        name: "John Doe",
                        amount: 15,
                        isPaid: true,
                        paidAt: new Date()
                    },
                    {
                        userId: users[1]._id,
                        name: "Alice Smith",
                        amount: 15,
                        isPaid: true,
                        paidAt: new Date()
                    },
                    {
                        userId: users[2]._id,
                        name: "Bob Wilson",
                        amount: 15,
                        isPaid: true,
                        paidAt: new Date()
                    }
                ],
                status: "settled",
                settledAt: new Date()
            }
        ]);

        console.log("Created sample expenses");

        console.log("🌱 Database seeded successfully!");
        console.log("Sample credentials:");
        console.log("Email: john@example.com, Password: password123");
        console.log("Email: alice@example.com, Password: password123");
        console.log("Email: bob@example.com, Password: password123");
        console.log("Email: charlie@example.com, Password: password123");

    } catch (error) {
        console.error("Error seeding database:", error);
    } finally {
        mongoose.connection.close();
    }
};

// Run the seed function
seedData();