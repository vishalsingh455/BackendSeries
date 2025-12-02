import {asyncHandler} from '../utils/asyncHandler.js'
import {ApiError} from '../utils/ApiError.js'
import {User} from '../models/user.model.js'
import {uploadOnCloudinary} from '../utils/cloudinary.js'
import { ApiResponse } from '../utils/ApiResponse.js'
import jwt from 'jsonwebtoken'

const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId)
    const accessToken = user.generateAccessToken()
    const refreshToken = user.generateRefreshToken()

    user.refreshToken = refreshToken
    await user.save({ validateBeforeSave:false })

    return {accessToken, refreshToken}
  } catch (error) {
    throw new ApiError(500, "Something went wrong while generating refresh and access tokens")
  }
}

const registerUser = asyncHandler( async (req, res) => {
  //get user detail from frontend
  //validation -> not empty
  // check if user already exists: username, email
  // check for images, avatar
  // upload them to cloudinary - avatar
  // create user object -create entry in db
  // remove password and refresh token from response
  // check for user creation
  // return response

  const {username, fullName, email, password} = req.body
  //console.log("Email: ", email);

  if(
    [email, password, username, fullName].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "All fields are required")
  }

  const existedUser = await User.findOne({
    $or: [{username }, { email }]
  })
  if(existedUser) {
    throw new ApiError(409, "User already exist")
  }

  //const avatarLocalPath = req.files?.avatar[0]?.path;
  //const coverImageLocalPath = req.files?.coverImage[0]?.path;
  let coverImageLocalPath;
  if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
    coverImageLocalPath = req.files.coverImage[0].path
  }

  let avatarLocalPath;
  if(req.files && Array.isArray(req.files.avatar) && req.files.avatar.length > 0) {
    avatarLocalPath = req.files.avatar[0].path
  }

  if(!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is required")
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath);
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  if(!avatar) {
    throw new ApiError(400, "Avatar file is required")
  }

  const user = await User.create({
    fullName, 
    avatar : avatar.url,
    coverImage : coverImage?.url || "",
    email, 
    password,
    username:username.toLowerCase()
  })

  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  )

  if(!createdUser) {
    throw new ApiError(500, "Something went wrong while registering the user")
  }

  return res.status(201).json(
    new ApiResponse(200, createdUser, "User registered successfully")
  )




})

const loginUser = asyncHandler(async (req, res) => {
  //req body -> data
  //username or email
  //find the user
  //password check
  //access and refresh token
  //send cookie

  const {email, username, password} = req.body
  console.log(email);

  if(!username && !password) {
    throw new ApiError(400, "username or password is required")
  }

  const user = await User.findOne({
    $or: [{ username }, { email }]
  })

  if(!user) {
    throw new ApiError(404, "User does not exist")
  }

  const isPasswordValid = await user.isPasswordCorrect(password);
  if(!isPasswordValid) {
    throw new ApiError(401, "Invalid User Credentials")
  }

  const {accessToken, refreshToken} = await generateAccessAndRefreshTokens(user._id)

  const loggedInUser = await User.findById(user._id).select("-password -refreshToken")

  const options = {
    httpOnly:true,
    secure:true
  }

  return res
  .status(200)
  .cookie("accessToken", accessToken, options)
  .cookie("refreshToken", refreshToken, options)
  .json(
    new ApiResponse(
      200,
      {
        user: loggedInUser, accessToken, refreshToken
      },
      "User LoggedIn Successfully..."
    )
  )
})

const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        refreshToken:undefined
      }
    },
    {
      new:true
    }
  )

  const options = {
    httpOnly:true,
    secure:true
  }
  return res
  .status(200)
  .clearCookie("refreshToken", options)
  .clearCookie("accessToken", options)
  .json(new ApiResponse(200, {}, "User Logged Out Successfully..."))
})

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken
  if(!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized Access")

  }

  try {
    const decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    )
  
    const user = await User.findById(decodedToken?._id);
    if(!user) {
      throw new ApiError(401, "Invalid refresh token")
    }
  
    if(incomingRefreshToken !== user.refreshToken) {
      throw new ApiError(401, "Refresh token is expired or used")
    }
  
    const options = {
      httpOnly:true,
      secure:true
    }
  
    const {accessToken, newRefreshToken} = await generateAccessAndRefreshTokens(user_id)
  
    res
    .status(200)
    .cookie("refreshToken", newRefreshToken, options)
    .cookie("accessToken", accessToken, options)
    .json(
      new ApiResponse(
        200,
        {
          accessToken, refreshToken:newRefreshToken
        },
        "Access Token Refreshed Successfully"
      )
    )
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh token")
  }
})

const changeCurrentPassword = asyncHandler(async (req, res) => {
  const {oldPassword, newPassword} = req.body

  const user = await User.findById(req.user?._id)
  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

  if(!isPasswordCorrect) {
    throw new ApiError(400, "Incorrect Old Password")
  }

  user.password = newPassword
  await user.save({validateBeforeSave:false})

  return res
  .status(200)
  .json(new ApiResponse(200, {}, "Password Changed Successfully"))
})

const getCurrentUser = asyncHandler(async (req, res) => {
  return res
  .status(200)
  .json(200, req.user, "Current User Fetched Successfully")
})

const updateUserDetails = asyncHandler(async (req, res) => {
  const {email, fullName} = req.body
  if(!fullName || !email) {
    throw new ApiError(400, "All fields are required")
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set:{
        email,
        fullName
      }
    },
    {new:true}
  ).select("-password")

  return res
  .status(200)
  .json(new ApiResponse(200, user, "Account Updated Successfully..."))
})

const updateUserAvatar = asyncHandler(async (req, res) => {
  const avatarLocalPath = req.file?.path
  if(!avatarLocalPath) {
    throw new ApiError(400, "Avatar is missing")
  }
  const avatar = await uploadOnCloudinary(avatarLocalPath)

  if(!avatar.url) {
    throw new ApiError(400, "Error while updating and uploading avatar on cloudinary...")
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        avatar:avatar.url
      }
    },
    {new:true}
  ).select("-password")

  return res
  .status(200)
  .json(new ApiResponse(200, user, "Avatar Updated Successfully..."))
})

const updateUserCoverImage = asyncHandler(async (req, res) => {
  const coverImageLocalPath = req.file?.path
  if(!coverImageLocalPath) {
    throw new ApiError(400, "Cover Image is missing")
  }
  const coverImage = await uploadOnCloudinary(coverImageLocalPath)

  if(!coverImage.url) {
    throw new ApiError(400, "Error while updating and uploading Cover Image on cloudinary...")
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        coverImage:coverImage.url
      }
    },
    {new:true}
  ).select("-password")

  return res
  .status(200)
  .json(new ApiResponse(200, user, "Cover Image Updated Successfully..."))
})

export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  getCurrentUser,
  changeCurrentPassword,
  updateUserDetails,
  updateUserAvatar,
  updateUserCoverImage
}