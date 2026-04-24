# AI-Powered Job Application Tailoring Platform

An intelligent web application that helps job seekers generate tailored CVs and cover letters for specific roles using their stored experience, projects, skills, and certifications.

Instead of rewriting application documents from scratch for every job, users enter their background once into the platform. The app then analyzes a job description, matches the most relevant experience from the database, and generates customized application materials grounded in the user’s real information.


---

## Problem

Applying for jobs is repetitive and time-consuming.

Most candidates need to:

- rewrite the same experience for different roles

- adjust CVs to match job descriptions

- create new cover letters for each company

- keep track of which application version was sent where

This process is especially painful for students, graduates, and early-career tech professionals who may be applying to many roles at once.

---

## Solution

To create an AI-powered career document generation system that uses structured user experience data to produce customized, role-specific application materials.

---

## Architecture Diagram



---

## Core Features

### MVP Features


- User profile creation and editing

- Structured storage for:

  - personal summary

  - education

  - work experience

  - technical skills

  - projects

  - certifications

- Job description input

- AI-powered job requirement extraction

- Relevance matching between job description and user profile

- Tailored CV generation

- Tailored cover letter generation

- Export generated documents

![MVP Architecture Diagram](Image/MVP-Archeticture.png)


1. Profile service Lambda
   1. Create user profile
   2. update profile
   3. Read and write to RDS
2. Job tailoring Lambda
   1. receive job description
   2. fetch user profile form DB
   3. call Bedrock
   4. CV/Cover letter generate
   5. return result

#### Step-1
Use CDK to create apigateway and lambda then test it

- remember dont delete the S3 bucket made form the bootstrap otherwise u need to delete the CDKToolkit stack and bootstrap again

```
> curl -X PUT "https://kbmowaael3.execute-api.us-east-1.amazonaws.com/profile"
{"message": "Profile service API is running"}%  
```
this show that the apigateway and lambda is successfully running!

- i have done some update for the stack code, so now the lambda code is not use 
Code.formInline but Code.fromAsset, and it turn out that the cloudformation will put the lambda in the zip and in a default bucket

```
ProfileServiceHandler4430D52F:
    Type: AWS::Lambda::Function
    Properties:
      Code:
        S3Bucket:
          Fn::Sub: cdk-hnb659fds-assets-${AWS::AccountId}-${AWS::Region}
        S3Key: d0ec76d1f190c9fdca3600e82a628d9b7eabbee7ca98041fa28f10fe43b79ddb.zip
      Handler: index.handler
```
- alright i make the lambda took json data and echo back

```
curl -X PUT "https://kbmowaael3.execute-api.us-east-1.amazonaws.com/profile" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Allan Chien",
    "email": "allan@example.com",
    "skills": ["AWS", "Python", "Docker"],
    "projects": [
      {
        "name": "Stock Market Real-Time Data Analytics Pipeline on AWS"
      }
    ]
  }'
{"message": "Profile received successfully", "received_profile": {"full_name": "Allan Chien", "email": "allan@example.com", "skills": ["AWS", "Python", "Docker"], "projects": [{"name": "Stock Market Real-Time Data Analytics Pipeline on AWS"}]}}%   
```


--- 

## Phase 2

- 